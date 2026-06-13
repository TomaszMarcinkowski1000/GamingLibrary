import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { LibraryEntry, LibraryEntryInsert, LibraryEntryUpdate } from "@/types";
import { lookupGameMetadata } from "./igdb";

/**
 * Thrown by `updateLibraryEntry`/`deleteLibraryEntry` when the targeted row does not exist —
 * either a bad id or another user's row hidden by RLS (Supabase does not error on a no-row
 * update/delete). Routes catch this to answer 404 instead of 500.
 */
export class EntryNotFoundError extends Error {
  constructor(id: string) {
    super(`Library entry not found: ${id}`);
    this.name = "EntryNotFoundError";
  }
}

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
 * Update a single library entry, writing the full editable field set as one patch (FR-010).
 *
 * Last-write-wins: the caller sends the complete editable set and we write it verbatim. RLS
 * scopes the `.eq('id', id)` to the current user, so a wrong or foreign id matches zero rows —
 * Supabase returns no error in that case, so we request the row back via `.select().single()`
 * and translate the empty result (PostgREST `PGRST116`) into a thrown {@link EntryNotFoundError}.
 * Never writes `id`/`user_id`/`created_at`.
 */
export async function updateLibraryEntry(
  supabase: TypedSupabaseClient,
  id: string,
  patch: LibraryEntryUpdate,
): Promise<LibraryEntry> {
  const { data, error } = await supabase.from("library_entries").update(patch).eq("id", id).select().single();
  if (error) {
    // PGRST116 = "no rows returned" for a `.single()` that matched nothing → not found.
    if (error.code === "PGRST116") {
      throw new EntryNotFoundError(id);
    }
    throw error;
  }
  return data as LibraryEntry;
}

/**
 * Delete a single library entry by id (FR-011, hard delete).
 *
 * RLS scopes the delete to the current user. A no-row delete (bad/foreign id) is silent in
 * Supabase, so we `.select('id')` the deleted set back and throw {@link EntryNotFoundError}
 * when it's empty, letting the route answer 404 rather than a misleading 204.
 */
export async function deleteLibraryEntry(supabase: TypedSupabaseClient, id: string): Promise<void> {
  const { data, error } = await supabase.from("library_entries").delete().eq("id", id).select("id");
  if (error) {
    throw error;
  }
  if (data.length === 0) {
    throw new EntryNotFoundError(id);
  }
}

/**
 * Escape characters significant to SQL LIKE/ILIKE so a user's search term matches
 * literally inside a `%…%` pattern: the backslash escape char itself, plus the `%`
 * and `_` wildcards. Without this, a query of `%` or `_` would over-match every row.
 * Backslash is escaped first so the escapes we add aren't themselves re-escaped.
 * (Only `.ilike(column, pattern)` is used — never raw PostgREST filter strings — so
 * the `,`/`(`/`)`/`*` list delimiters are handled by supabase-js, not us.)
 */
function escapeLikeTerm(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * List the current user's library entries, newest first, one page at a time.
 *
 * Returns the page of entries plus the exact total (for pagination bounds). `page` is
 * clamped to >= 1. `from = (page - 1) * pageSize`, `to = from + pageSize - 1`.
 *
 * When `search` is a non-blank string, the list is filtered to entries whose `title`
 * contains it case-insensitively (`ilike "%term%"`); the term's LIKE wildcards are
 * escaped so it matches literally. A blank/whitespace `search` is treated as no filter.
 * The filter is applied before `count: "exact"`, so `total` reflects the match count.
 *
 * Out-of-bounds pages self-heal: a `page` past the last page (e.g. a deep-linked
 * `?page=99`, or `?page=2` after the last row was deleted) makes PostgREST answer the
 * ranged request with 416 / `PGRST103`. Rather than surface that as a load error, we
 * fetch the count, clamp to the last valid page, and re-fetch — so the caller always
 * gets a real page plus the (filtered) total. The common in-range path stays one query.
 */
export async function listLibraryEntries(
  supabase: TypedSupabaseClient,
  { page, pageSize, search }: { page: number; pageSize: number; search?: string },
): Promise<{ entries: LibraryEntry[]; total: number }> {
  const term = search?.trim();

  // Each fetch needs a fresh builder (PostgREST builders are single-use), so the filter
  // set lives in one factory both the initial and the clamp re-fetch reuse.
  const buildQuery = (head: boolean) => {
    let query = supabase.from("library_entries").select("*", { count: "exact", head });
    if (term) {
      query = query.ilike("title", `%${escapeLikeTerm(term)}%`);
    }
    return query;
  };

  const fetchPage = (targetPage: number) => {
    const from = (targetPage - 1) * pageSize;
    const to = from + pageSize - 1;
    return buildQuery(false).order("created_at", { ascending: false }).range(from, to);
  };

  const safePage = Math.max(1, Math.floor(page));
  let { data, count, error } = await fetchPage(safePage);

  // PGRST103 = "Requested range not satisfiable": the offset is past the last row. Learn the
  // total via a head-only count, clamp to the last page, and re-fetch that valid page.
  if (error?.code === "PGRST103") {
    const { count: total, error: countError } = await buildQuery(true);
    if (countError) {
      throw countError;
    }
    const lastPage = Math.max(1, Math.ceil((total ?? 0) / pageSize));
    if (lastPage < safePage) {
      ({ data, count, error } = await fetchPage(lastPage));
    }
  }

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
