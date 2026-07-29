import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { lookupGameMetadata } from "@/lib/services/igdb";
import { createLibraryEntryFromGrounding } from "@/lib/services/library";
import { createClient } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { identifyGameFromPhoto, stubbedVisionRead } from "@/lib/services/vision";
import type { IdentifyResponse, IgdbLookupResult, LibraryEntry, VisionIdentifyResult } from "@/types";

export const prerender = false;

/**
 * POST /api/identify — photo → proposed game (F-03 spike).
 *
 * Accept a single uploaded box photo, run it through the vision service, ground a successful
 * identification against IGDB, and return the proposed entry plus its grounded `igdbId` (the
 * value the accuracy harness scores on) — or an honest `unsure`. Auth-gated and runtime-correct
 * (`cloudflare:workers` env, never `locals.runtime`) so S-03 can reuse it verbatim.
 *
 * By default this route does NOT persist anything — the spike/harness path measures
 * `{title, platform, igdbId}` and never writes to `library_entries`. S-03's UI opts into
 * persistence with a `persist` form field: a confident read is auto-saved from the grounding
 * already in hand and the created row is returned as `entry` (see POST).
 */

// Response contract lives in `src/types.ts` ({@link IdentifyResponse}) so the route and the
// PhotoCapture island share one definition. `identified` carries the grounded `igdbId` and, on the
// persist path, the created `entry`; `unsure` is the explicit abstain. `debug` is diagnostic-only —
// the accuracy harness reads `igdbId`/`status`/`platform`/`title` for correctness, never `debug`.

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

// Max accepted upload. workerd has no Node `sharp`, so we can't downscale server-side; until S-03
// adds a Worker-safe resize, cap the raw bytes instead. 10 MB clears a downscaled box photo with
// headroom while bounding the base64 string we hold in memory (~33% inflation) and the vision payload.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Upload contract: a single non-empty image `File` under the fixed `photo` field. An absent,
 * empty, oversized, or non-image part is a client error (400), validated at the boundary like every other route.
 */
const uploadSchema = z.object({
  photo: z
    .instanceof(File, { message: "a `photo` image file is required" })
    .refine((file) => file.size > 0, "the uploaded `photo` is empty")
    .refine((file) => file.size <= MAX_UPLOAD_BYTES, "the uploaded `photo` exceeds the 10 MB limit")
    .refine((file) => ACCEPTED_IMAGE_TYPES.includes(file.type), "unsupported image type (png/jpeg/webp/gif only)"),
  // Opt-in persistence (S-03 UI). Absent/anything-but-"true" keeps the harness path (no write).
  // `form.get` yields `string | null`; normalize to a boolean here.
  persist: z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => value === "true"),
});

/**
 * Grounding-shortcut contract (GET): both query params are required, non-empty after trimming —
 * same shape `lookupGameMetadata` enforces internally, validated here so a bad query is a clean 400.
 */
const groundingQuerySchema = z.object({
  title: z.string().trim().min(1, "`title` query param is required"),
  platform: z.string().trim().min(1, "`platform` query param is required"),
});

/**
 * Build a `data:<mime>;base64,<data>` URL from the uploaded bytes using Web APIs only (workerd has
 * no Node `Buffer`). Encode in chunks: `btoa(String.fromCharCode(...wholeArray))` blows the call
 * stack on a large byte spread (docs/openrouter.md §2).
 */
function toBase64DataUrl(bytes: Uint8Array, mimeType: string): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/**
 * GET /api/identify?title=&platform= — truth-id grounding shortcut for the accuracy harness.
 *
 * The harness scores the model's grounded `igdbId` against the *truth* id of each labeled photo.
 * To resolve that truth id through the exact same path the model output travels (so both sides are
 * grounded symmetrically), it grounds `true_title` + `true_platform` here via `lookupGameMetadata`
 * and reads back `{ igdbId, metadataStatus }`. Auth-gated and read-only — harmless in prod, but its
 * only consumer is the dev harness. (The harness may instead pin `true_igdb_id` in labels.csv and
 * skip this call entirely.)
 */
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const query = groundingQuerySchema.safeParse({
    title: url.searchParams.get("title"),
    platform: url.searchParams.get("platform"),
  });
  if (!query.success) {
    return Response.json({ error: query.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  let grounding: IgdbLookupResult | null = null;
  try {
    grounding = await lookupGameMetadata(query.data.title, query.data.platform, env.IGDB_TOKENS);
  } catch (error) {
    // IGDB/Twitch transport, auth, or missing-KV failure — the harness needs to distinguish this
    // from a clean no-match, so surface it as a 502 rather than a null id.
    logError("identify.truth_grounding_failed", error, { title: query.data.title, platform: query.data.platform });
    return Response.json({ error: error instanceof Error ? error.message : "IGDB grounding failed" }, { status: 502 });
  }

  return Response.json({
    igdbId: grounding.status === "matched" ? grounding.igdbId : null,
    metadataStatus: grounding.status,
  });
};

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  // Auth gate (mirror api/library/index.ts) — the route is shared with S-03, so it stays gated.
  if (!locals.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data with a `photo` file" }, { status: 400 });
  }

  const parsed = uploadSchema.safeParse({ photo: form.get("photo"), persist: form.get("persist") });
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { photo, persist } = parsed.data;
  const dataUrl = toBase64DataUrl(new Uint8Array(await photo.arrayBuffer()), photo.type);

  // Deterministic e2e seam (`vision.ts`): a request that proves knowledge of the server-side
  // `E2E_VISION_STUB_KEY` gets a canned identified read instead of the provider hop. Disarmed unless
  // that secret is set, so it is a no-op in production and across the whole Vitest suite. It sits
  // here, and only here, so everything above (auth gate, multipart parse, size/mime validation,
  // base64 encode) and everything below (grounding, persist, response shape) stays on the real path.
  let vision: VisionIdentifyResult | null = stubbedVisionRead(request.headers);

  if (vision === null) {
    // Vision call. A missing OPENROUTER_API_KEY or a non-2xx OpenRouter response throws (carrying the
    // upstream body) — surface it as a clean 502 with the message, never a 500 stack trace.
    try {
      vision = await identifyGameFromPhoto(dataUrl);
    } catch (error) {
      // `vision.ts` already logs a non-2xx OpenRouter body; this also catches the cases it can't
      // (missing OPENROUTER_API_KEY, envelope schema drift), which otherwise leave no trace at all.
      logError("identify.vision_failed", error);
      return Response.json(
        { error: error instanceof Error ? error.message : "Vision identification failed" },
        { status: 502 },
      );
    }
  }

  if (vision.status === "unsure") {
    return Response.json({ status: "unsure", confidence: vision.confidence } satisfies IdentifyResponse);
  }

  // Ground the read through IGDB. Best-effort like createLibraryEntry (library.ts:55): a flaky IGDB
  // transport must not 500 a good vision read — degrade to a null id instead.
  let grounding: IgdbLookupResult | null = null;
  try {
    grounding = await lookupGameMetadata(vision.title, vision.platform, env.IGDB_TOKENS);
  } catch (error) {
    // IGDB/Twitch transport, auth, or missing-KV failure — fall through to a null-id response, but
    // record it: on the harness path this silently depresses the accuracy metric (a groundable read
    // scores as an abstain), which would otherwise read as the *model* getting worse.
    logError("identify.grounding_failed", error, { title: vision.title, platform: vision.platform });
  }

  // Persist path (S-03 UI): a confident vision read is auto-saved straight into the library from the
  // grounding already in hand — matched → full metadata, no_match/null → nulls + `no_match`. This
  // INVERTS the harness's no_match→unsure fold below: the UI wants the saved entry, not an abstain.
  // (Only a *vision* `unsure`, handled above, routes to the manual fallback.)
  if (persist) {
    const supabase = createClient(request.headers, cookies);
    if (!supabase) {
      return Response.json({ error: "Supabase is not configured" }, { status: 500 });
    }

    let entry: LibraryEntry;
    try {
      entry = await createLibraryEntryFromGrounding(supabase, {
        title: vision.title,
        platform: vision.platform,
        grounding,
      });
    } catch (error) {
      // The user just spent a photo upload and a vision call on this; if the save is what broke,
      // the status-only 500 is all they see, so the cause has to be captured here.
      logError("identify.persist_failed", error, { title: vision.title, userId: locals.user.id });
      return Response.json({ error: "Failed to save the entry" }, { status: 500 });
    }

    return Response.json({
      status: "identified",
      title: vision.title,
      platform: vision.platform,
      confidence: vision.confidence,
      igdbId: grounding?.status === "matched" ? grounding.igdbId : null,
      metadataStatus: entry.metadata_status,
      debug: { collapsedFrom: grounding?.status === "matched" ? (grounding.collapsedFrom ?? null) : null },
      entry,
    } satisfies IdentifyResponse);
  }

  // Harness path (persist off) — abstain on IGDB no-match (load-bearing for the metric): a successful
  // vision read that grounds to `no_match` has no id to score, so it's an abstain, NOT a confident
  // answer. This keeps "wrong" (grounded to the wrong id) distinct from "couldn't ground". The harness
  // relies on this split.
  if (grounding?.status === "no_match") {
    return Response.json({ status: "unsure", confidence: vision.confidence } satisfies IdentifyResponse);
  }

  return Response.json({
    status: "identified",
    title: vision.title,
    platform: vision.platform,
    confidence: vision.confidence,
    igdbId: grounding?.status === "matched" ? grounding.igdbId : null,
    metadataStatus: grounding?.status === "matched" ? "matched" : null,
    debug: { collapsedFrom: grounding?.status === "matched" ? (grounding.collapsedFrom ?? null) : null },
  } satisfies IdentifyResponse);
};
