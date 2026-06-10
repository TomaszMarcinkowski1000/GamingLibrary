import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { LibraryEntry, LibraryEntryInsert } from "@/types";
import { lookupGameMetadata } from "./igdb";

/**
 * Library entry service (S-01).
 *
 * Owns create-with-enrichment, paginated listing, and used-platform queries so API
 * routes and pages stay thin. Every function takes an already-authenticated Supabase
 * client (the non-null return of `createClient`) as its first arg — RLS does user
 * isolation, so these queries never filter by `user_id` themselves.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

/** Server-compute today's date as a `YYYY-MM-DD` string for the `date_bought` column. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Create a library entry, enriching it with IGDB metadata at save time (FR-008).
 *
 * Enrichment is best-effort and must never cost the user their input: `lookupGameMetadata`
 * is wrapped in try/catch. A `matched` result populates the metadata columns and sets
 * `metadata_status='matched'`; a `no_match` result *or any thrown error* (empty input,
 * IGDB/Twitch transport/auth failure, missing KV) folds into nulls + `metadata_status='no_match'`.
 * The insert always happens.
 *
 * `date_bought` defaults to today; `play_status` and `user_id` fall to their DB defaults.
 */
export async function createLibraryEntry(
  supabase: TypedSupabaseClient,
  kv: KVNamespace,
  input: { title: string; platform: string },
): Promise<LibraryEntry> {
  const { title, platform } = input;

  // Enrichment columns default to "no metadata" and are overwritten only on a match.
  let metadata: Pick<
    LibraryEntryInsert,
    "igdb_id" | "genre" | "developer" | "series" | "release_year" | "release_date" | "length_hours" | "metadata_status"
  > = {
    igdb_id: null,
    genre: null,
    developer: null,
    series: null,
    release_year: null,
    release_date: null,
    length_hours: null,
    metadata_status: "no_match",
  };

  try {
    const result = await lookupGameMetadata(title, platform, kv);
    if (result.status === "matched") {
      metadata = {
        igdb_id: result.igdbId,
        genre: result.genre,
        developer: result.developer,
        series: result.series,
        release_year: result.releaseYear,
        release_date: result.releaseDate,
        length_hours: result.lengthHours,
        metadata_status: "matched",
      };
    }
  } catch {
    // A flaky external API (or absent KV/secrets in local dev) must not lose the entry —
    // it saves as `no_match` with the user-supplied fields intact.
  }

  const payload: LibraryEntryInsert = {
    title,
    platform,
    date_bought: today(),
    ...metadata,
  };

  const { data, error } = await supabase.from("library_entries").insert(payload).select().single();
  if (error) {
    throw error;
  }
  return data as LibraryEntry;
}

/**
 * List the current user's library entries, newest first, one page at a time.
 *
 * Returns the page of entries plus the exact total (for pagination bounds). `page` is
 * clamped to >= 1. `from = (page - 1) * pageSize`, `to = from + pageSize - 1`.
 */
export async function listLibraryEntries(
  supabase: TypedSupabaseClient,
  { page, pageSize }: { page: number; pageSize: number },
): Promise<{ entries: LibraryEntry[]; total: number }> {
  const safePage = Math.max(1, Math.floor(page));
  const from = (safePage - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count, error } = await supabase
    .from("library_entries")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    throw error;
  }
  return { entries: data as LibraryEntry[], total: count ?? 0 };
}

/**
 * Distinct non-null platform values already used in the current user's library.
 *
 * Computed in Postgres via the `list_used_platforms` RPC (DISTINCT ON + per-user index)
 * rather than selecting every row and deduping in JS, so cost stays flat as the library
 * grows. Deduped case-insensitively, so the combobox can offer a user's own past
 * free-text platforms (e.g. "Evercade") alongside the curated list.
 */
export async function listUsedPlatforms(supabase: TypedSupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.rpc("list_used_platforms");
  if (error) {
    throw error;
  }
  return data;
}
