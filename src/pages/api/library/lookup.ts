import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import type { IgdbLookupResult } from "@/types";
import { lookupGameMetadata } from "@/lib/services/igdb";
import { logError } from "@/lib/logger";
import { lookupRequestSchema } from "@/lib/validation/library";

export const prerender = false;

/**
 * POST /api/library/lookup — run IGDB enrichment for a title+platform WITHOUT persisting.
 *
 * Backs the edit dialog's "Re-fetch metadata" button: returns the lookup result so the form
 * can populate its metadata fields for review. Auth-gated so anonymous callers can't drive the
 * external API.
 *
 * Unlike S-01's create, this route does NOT fold a thrown lookup into `{ status: 'no_match' }`.
 * There the degradation buys something real — the user's entry gets saved regardless. Here it buys
 * nothing and costs correctness: this route's entire output *is* the lookup, so answering
 * `no_match` on an IGDB outage tells the user "that game isn't in IGDB" when the truth is "we
 * couldn't ask". They then hand-fill metadata that a retry would have populated. A transport /
 * auth / missing-KV failure is an upstream failure, so it surfaces as a 502 (mirroring
 * `GET /api/identify`) and the dialog offers a retry. Nothing is persisted either way, so the
 * user's typed input is never at risk.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = lookupRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  let result: IgdbLookupResult;
  try {
    result = await lookupGameMetadata(parsed.data.title, parsed.data.platform, env.IGDB_TOKENS);
  } catch (error) {
    logError("library.lookup.igdb_unavailable", error, {
      title: parsed.data.title,
      platform: parsed.data.platform,
    });
    // Status-only for the client: the thrown message can carry IGDB/Twitch auth detail.
    return Response.json({ error: "Couldn't reach the metadata service" }, { status: 502 });
  }
  return Response.json({ result }, { status: 200 });
};
