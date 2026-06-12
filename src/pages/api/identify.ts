import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { lookupGameMetadata } from "@/lib/services/igdb";
import { identifyGameFromPhoto } from "@/lib/services/vision";
import type { IgdbLookupResult, MetadataStatus } from "@/types";

export const prerender = false;

/**
 * POST /api/identify — photo → proposed game (F-03 spike).
 *
 * Accept a single uploaded box photo, run it through the vision service, ground a successful
 * identification against IGDB, and return the proposed entry plus its grounded `igdbId` (the
 * value the accuracy harness scores on) — or an honest `unsure`. Auth-gated and runtime-correct
 * (`cloudflare:workers` env, never `locals.runtime`) so S-03 can reuse it verbatim.
 *
 * This route does NOT persist anything — the spike measures `{title, platform, igdbId}`, it does
 * not write to `library_entries` (that's S-03's `createLibraryEntry`).
 */

/**
 * Response contract. `identified` carries the grounded `igdbId` (null only when IGDB transport
 * failed — a `no_match` is folded into `unsure`, see below). `unsure` is the explicit abstain.
 * Discriminant `status` matches the vision + IGDB result unions.
 */
type IdentifyResponse =
  | {
      status: "identified";
      title: string;
      platform: string;
      confidence: number;
      igdbId: number | null;
      metadataStatus: MetadataStatus | null;
    }
  | { status: "unsure"; confidence: number };

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * Upload contract: a single non-empty image `File` under the fixed `photo` field. An absent,
 * empty, or non-image part is a client error (400), validated at the boundary like every other route.
 */
const uploadSchema = z.object({
  photo: z
    .instanceof(File, { message: "a `photo` image file is required" })
    .refine((file) => file.size > 0, "the uploaded `photo` is empty")
    .refine((file) => ACCEPTED_IMAGE_TYPES.includes(file.type), "unsupported image type (png/jpeg/webp/gif only)"),
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

export const POST: APIRoute = async ({ request, locals }) => {
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

  const parsed = uploadSchema.safeParse({ photo: form.get("photo") });
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { photo } = parsed.data;
  const dataUrl = toBase64DataUrl(new Uint8Array(await photo.arrayBuffer()), photo.type);

  // Vision call. A missing OPENROUTER_API_KEY or a non-2xx OpenRouter response throws (carrying the
  // upstream body) — surface it as a clean 502 with the message, never a 500 stack trace.
  let vision;
  try {
    vision = await identifyGameFromPhoto(dataUrl);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Vision identification failed" },
      { status: 502 },
    );
  }

  if (vision.status === "unsure") {
    return Response.json({ status: "unsure", confidence: vision.confidence } satisfies IdentifyResponse);
  }

  // Ground the read through IGDB. Best-effort like createLibraryEntry (library.ts:55): a flaky IGDB
  // transport must not 500 a good vision read — degrade to a null id instead.
  let grounding: IgdbLookupResult | null = null;
  try {
    grounding = await lookupGameMetadata(vision.title, vision.platform, env.IGDB_TOKENS);
  } catch {
    // IGDB/Twitch transport, auth, or missing-KV failure — fall through to a null-id response.
  }

  // Decision — abstain on IGDB no-match (load-bearing for the metric): a successful vision read that
  // grounds to `no_match` has no id to score, so it's an abstain, NOT a confident answer. This keeps
  // "wrong" (grounded to the wrong id) distinct from "couldn't ground". The harness relies on this split.
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
  } satisfies IdentifyResponse);
};
