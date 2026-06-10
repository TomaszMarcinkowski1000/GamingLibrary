import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { createLibraryEntry } from "@/lib/services/library";

export const prerender = false;

/**
 * Add-game request contract: both fields required, trimmed, non-empty. Matches the
 * `lookupGameMetadata` input shape — empty input is a client error (400), not a
 * degraded `no_match`.
 */
const createEntrySchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  platform: z.string().trim().min(1, "platform is required"),
});

/**
 * POST /api/library — enrich-and-save a single library entry (S-01).
 *
 * The only API surface of this slice; the list and platform options are read
 * server-side in the page. Enrichment failures do NOT error the request — the service
 * folds them into a `no_match` save so a flaky external API never costs the user input.
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  if (!locals.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createEntrySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    const entry = await createLibraryEntry(supabase, env.IGDB_TOKENS, parsed.data);
    return Response.json({ entry }, { status: 201 });
  } catch {
    // Enrichment never reaches here (the service swallows it); only an unexpected DB
    // failure does.
    return Response.json({ error: "Failed to save the entry" }, { status: 500 });
  }
};
