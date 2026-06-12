import { OPENROUTER_API_KEY } from "astro:env/server";
import { z } from "zod";
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

/**
 * Identify a game's title + platform from a box photo.
 *
 * @param imageDataUrl A `data:image/<fmt>;base64,<data>` URL (built by the caller from the
 *   uploaded `File`). The route does the upload decode; this service only speaks to the model.
 * @throws if `OPENROUTER_API_KEY` is unset (mirrors `createIgdbClient`'s loud failure), or on
 *   a non-2xx OpenRouter response (carries the error body so the route/harness surfaces it).
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
    const errorBody = await response.text();
    throw new Error(`OpenRouter request failed (${response.status}): ${errorBody}`);
  }

  const envelope = envelopeSchema.parse(await response.json());
  const rawContent = envelope.choices[0].message.content;

  // Structured mode returns the JSON as a string in `message.content`; parse then validate.
  const parsed = modelOutputSchema.parse(JSON.parse(rawContent));

  if (parsed.confidence < CONFIDENCE_THRESHOLD) {
    return { status: "unsure", confidence: parsed.confidence };
  }

  return {
    status: "identified",
    title: parsed.title,
    platform: parsed.platform,
    confidence: parsed.confidence,
  };
}
