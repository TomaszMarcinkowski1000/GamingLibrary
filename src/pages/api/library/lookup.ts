import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import type { IgdbLookupResult } from "@/types";
import { lookupGameMetadata } from "@/lib/services/igdb";
import { lookupRequestSchema } from "@/lib/validation/library";

export const prerender = false;

/**
 * POST /api/library/lookup — run IGDB enrichment for a title+platform WITHOUT persisting.
 *
 * Backs the edit dialog's "Re-fetch metadata" button: returns the lookup result so the form
 * can populate its metadata fields for review. Auth-gated so anonymous callers can't drive the
 * external API. A thrown lookup error degrades to `{ status: 'no_match' }` (a flaky API is
 * never a 500 — same philosophy as S-01's create), never costing the user their typed input.
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
  } catch {
    result = { status: "no_match" };
  }
  return Response.json({ result }, { status: 200 });
};
