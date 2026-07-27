import { E2E_VISION_STUB_KEY, OPENROUTER_API_KEY } from "astro:env/server";
import { z } from "zod";
import { normalizePlatformLabel, normalizeTitleCasing } from "@/lib/platforms";
import type { VisionIdentifyResult } from "@/types";

/**
 * Vision identification service (F-03 spike).
 *
 * Given a single box photo as a base64 data URL, ask Gemini Flash (via OpenRouter's
 * OpenAI-compatible REST endpoint, raw `fetch` — no SDK, workerd-safe) for the game's
 * `{ title, platform, confidence }`, validate the structured JSON at the boundary with
 * zod, and collapse low-confidence answers into an explicit abstain.
 *
 * Follows the services convention: zod at the boundary, a discriminated-union result, and
 * loud throws only on missing secret / transport failure (mirrors `createIgdbClient`).
 */

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// Vision-capable Flash model with structured-output support. Confirm the live slug at
// https://openrouter.ai/models?q=gemini+flash before changing (the listing moves).
const VISION_MODEL = "google/gemini-2.5-flash";

/**
 * Single tunable abstain gate. A model answer whose self-reported confidence is below this
 * collapses to `unsure`, so the harness's "answered vs abstained" split is reproducible and
 * adjustable in one place.
 */
export const CONFIDENCE_THRESHOLD = 0.6;

/** Validates the model's structured JSON before we trust any of its fields. */
const modelOutputSchema = z.object({
  title: z.string(),
  platform: z.string(),
  confidence: z.number(),
});

/** OpenRouter chat-completion envelope — only the part we read, validated at the boundary. */
const envelopeSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

/** JSON schema handed to OpenRouter's strict structured-output mode (see docs/openrouter.md §3). */
const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "game_identification",
    strict: true,
    schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Game title printed on the box" },
        platform: { type: "string", description: "Console / platform, e.g. PlayStation 5" },
        confidence: { type: "number", description: "0..1 model confidence in the title+platform read" },
      },
      required: ["title", "platform", "confidence"],
      additionalProperties: false,
    },
  },
} as const;

const PROMPT =
  "Identify the video game and its platform from this box/case photo. " +
  "Return the exact game title as printed on the cover and the console/platform it is for " +
  "(e.g. PlayStation 5, Nintendo Switch, Xbox Series X). " +
  "Set confidence to your certainty in BOTH the title and the platform together, from 0 to 1. " +
  "If the image is not a recognizable game box, or you cannot read the title, return a low confidence.";

// --- e2e determinism seam ---
//
// The Playwright suite needs `POST /api/identify` to reach the saved-and-visible row without a live
// model call: the provider hop is the one nondeterministic, paid, network-dependent step in the
// journey. This seam replaces *only* that hop — the route's multipart contract, size/mime caps and
// base64 encode still run above it, and grounding, the insert and the SSR re-render still run below.
// The normalizers below stay on the path deliberately, so a stubbed read reaches the insert in the
// exact shape a real provider read would.
//
// Two independent locks, both absent in production: the server must hold a non-empty
// `E2E_VISION_STUB_KEY` *and* the request must echo it back in a header. `test/stubs/astro-env-server.ts`
// leaves the key `undefined`, so the whole Vitest suite runs as standing evidence that the default
// state is dead. See `.env.example` for the two-copies (`.dev.vars` + `.env`) requirement.

/** Header carrying the caller's proof of the server-side `E2E_VISION_STUB_KEY`. */
const STUB_KEY_HEADER = "x-e2e-vision-key";
/** Header carrying the title the canned read should return. Required — no title, no stub. */
const STUB_TITLE_HEADER = "x-e2e-vision-title";
/** Header carrying the platform the canned read should return. Optional. */
const STUB_PLATFORM_HEADER = "x-e2e-vision-platform";

/** Platform used when a stub request omits {@link STUB_PLATFORM_HEADER}. A canonical label already. */
const STUB_DEFAULT_PLATFORM = "PlayStation 5";

/**
 * Compare two short secrets without leaking, through timing, how long a shared prefix was.
 *
 * Unreachable in production — lock 1 below is unconditionally closed there — but once a shared
 * staging environment arms the seam, lock 2 is the only thing between a caller and arbitrary
 * control of the vision read, so it should not be a guessing oracle. Hand-rolled rather than
 * `crypto.timingSafeEqual`: this function is synchronous and runs under both workerd and Vitest's
 * node environment, and the inputs are short ASCII secrets. The loop length still varies with the
 * *longer* input, which reveals nothing about the key's content.
 */
function constantTimeEquals(a: string, b: string): boolean {
  // The length difference is folded into the accumulator rather than returned early on.
  let mismatch = a.length ^ b.length;
  const span = Math.max(a.length, b.length);
  for (let i = 0; i < span; i++) {
    // `charCodeAt` past the end is NaN; `|| 0` normalizes it without branching on which string ran out.
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

/**
 * Test-only substitute for the OpenRouter call, gated on a key the caller cannot know unless the
 * server was deliberately configured for e2e.
 *
 * @returns an `identified` read built from the request headers, or `null` to fall through to the
 *   real provider. Every failed check yields `null`, never a throw or a 4xx: a malformed test
 *   request degrades to the production path rather than to a confusing error.
 */
export function stubbedVisionRead(headers: Headers): VisionIdentifyResult | null {
  // Lock 1 — the server opted in. Trimmed first: RFC 7230 strips leading/trailing whitespace from
  // header values, so a key pasted into `.dev.vars` with a stray space would pass this check and
  // then be permanently unmatchable at lock 2 — failing closed, but presenting the operator with an
  // "armed" config that only ever produces the real provider's 502. An empty *or whitespace-only*
  // string counts as unset (`astro:env` optional secrets make "declared and blank" easy to conflate
  // with "absent"; both mean disarmed).
  const serverKey = E2E_VISION_STUB_KEY?.trim();
  if (!serverKey) return null;

  // Lock 2 — the caller proves knowledge of it. Trimmed for symmetry with lock 1.
  const presentedKey = headers.get(STUB_KEY_HEADER)?.trim();
  if (!presentedKey || !constantTimeEquals(presentedKey, serverKey)) return null;

  // Lock 3 — a canned read needs something to return.
  const title = headers.get(STUB_TITLE_HEADER)?.trim();
  if (!title) return null;

  // An absent *or blank* platform header takes the default; `??` would let a blank one through.
  const platformHeader = headers.get(STUB_PLATFORM_HEADER)?.trim();
  const platform = platformHeader === undefined || platformHeader === "" ? STUB_DEFAULT_PLATFORM : platformHeader;

  // Same normalization choke point the real read passes through (see `identifyGameFromPhoto`'s
  // return below) — the seam must not become a way to bypass it. Confidence is 1: the stub is by
  // construction above `CONFIDENCE_THRESHOLD`, so the route takes the identified branch.
  return {
    status: "identified",
    title: normalizeTitleCasing(title),
    platform: normalizePlatformLabel(platform),
    confidence: 1,
  };
}

/**
 * Identify a game's title + platform from a box photo.
 *
 * @param imageDataUrl A `data:image/<fmt>;base64,<data>` URL (built by the caller from the
 *   uploaded `File`). The route does the upload decode; this service only speaks to the model.
 * @throws if `OPENROUTER_API_KEY` is unset (mirrors `createIgdbClient`'s loud failure), or on
 *   a non-2xx OpenRouter response (status-only message; the upstream body is logged server-side, not surfaced).
 */
export async function identifyGameFromPhoto(imageDataUrl: string): Promise<VisionIdentifyResult> {
  // Declared `optional` in the env schema so build/CI proceed without live creds; a call
  // without the key cannot work, so fail loudly rather than 401 downstream.
  if (!OPENROUTER_API_KEY) {
    throw new Error("Missing OPENROUTER_API_KEY — set it in .dev.vars (local) or Worker secrets (prod).");
  }

  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      response_format: RESPONSE_FORMAT,
    }),
  });

  if (!response.ok) {
    // Log the upstream body server-side (it may carry model slugs / quota hints) but never surface it:
    // the route turns a thrown message into a client-facing 502, so keep it status-only to avoid leaking provider detail.
    const errorBody = await response.text();
    // eslint-disable-next-line no-console -- deliberate server-side diagnostic; never reaches the client
    console.error(`OpenRouter request failed (${response.status}): ${errorBody}`);
    throw new Error(`OpenRouter request failed (${response.status})`);
  }

  const envelope = envelopeSchema.parse(await response.json());
  const rawContent = envelope.choices[0].message.content;

  // Structured mode returns the JSON as a string in `message.content`; parse then validate.
  // Despite strict structured output, a refusal or malformed payload is an honest abstain, not a
  // transport failure — fold any parse/validation error to `unsure` rather than throwing a SyntaxError.
  let parsed;
  try {
    parsed = modelOutputSchema.parse(JSON.parse(rawContent));
  } catch {
    return { status: "unsure", confidence: 0 };
  }

  if (parsed.confidence < CONFIDENCE_THRESHOLD) {
    return { status: "unsure", confidence: parsed.confidence };
  }

  // Normalize the raw model read at this single choke point: human-cased title and canonical
  // platform label. Every consumer (route, persist save, harness) reads these fields off the
  // result, so they all inherit the normalized values with no further edit. Grounding ids are
  // invariant — `resolvePlatformIds`/`normalizeBaseTitle` already collapse aliases and case.
  return {
    status: "identified",
    title: normalizeTitleCasing(parsed.title),
    platform: normalizePlatformLabel(parsed.platform),
    confidence: parsed.confidence,
  };
}
