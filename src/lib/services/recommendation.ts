import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type {
  LengthBucket,
  LibraryEntry,
  NoveltyMode,
  RecommendationItem,
  RecommendationRequest,
  RecommendationResult,
} from "@/types";
import { LENGTH_BUCKET_BOUNDS } from "@/types";
import { listAllEntries } from "./library";

/**
 * Deterministic "what should I play next?" scoring engine (S-07, PRD US-03 / FR-015/016/018).
 *
 * `recommend()` is a pure function over `(entries, request)` — no Supabase, no I/O, no clock —
 * so identical inputs always produce identical output (the PRD's hard determinism guarantee).
 * The scoring model is a single weighted score whose weights are scaled into a strict priority
 * (length distance ≫ completion/status ≫ novelty), making the ordering effectively lexicographic
 * while staying a single number. A total-order tie-break (created_at → id) guarantees stability.
 *
 * See plan §"The scoring model (authoritative spec)" for the full contract.
 */

// --- Weights & constants ---

/**
 * Strict-priority weights. With the component ranges below — distance ∈ [0, NULL_DISTANCE],
 * statusPenalty ∈ [0, 1], novelty ∈ [0, 1] — one unit of distance (W_LEN) outweighs the entire
 * completion + novelty range (W_COMP + W_NOV = 101), and one comfort status step (≥ 1/3 of
 * W_COMP ≈ 33) outweighs the whole novelty range (W_NOV = 1). So the order is lexicographic:
 * length distance first, then status, then novelty.
 */
export const W_LEN = 1000;
export const W_COMP = 100;
export const W_NOV = 1;

/**
 * Length distance assigned to a null-`length_hours` entry: strictly greater than the max real
 * distance (3, between bucket 0 and bucket 3), so unbucketed games sort below any real-length
 * game on the dominant term — but are never excluded (length is a graded soft penalty, never the
 * binding empty-state constraint).
 */
export const NULL_DISTANCE = 4;

// --- Pure helpers (exported for unit tests) ---

/**
 * Map a length in hours to its bucket, or `null` when `length_hours` is null. Boundaries are
 * inclusive-low / exclusive-high (10 → medium, 30 → long, 60 → very_long); negatives clamp to
 * `short`.
 */
export function bucketOf(lengthHours: number | null): LengthBucket | null {
  if (lengthHours === null) {
    return null;
  }
  for (const bucket of ["short", "medium", "long", "very_long"] as const) {
    const { minH, maxH } = LENGTH_BUCKET_BOUNDS[bucket];
    if (lengthHours >= minH && (maxH === null || lengthHours < maxH)) {
      return bucket;
    }
  }
  // lengthHours < 0 falls through; treat as the shortest bucket.
  return "short";
}

/**
 * Bucket distance (lower = better): the minimum |entryBucket − selectedBucket| over the selected
 * buckets. In-bucket ⇒ 0. A null `length_hours` ⇒ {@link NULL_DISTANCE}. An empty selection (the
 * parser never produces one, but guard anyway) ⇒ NULL_DISTANCE so it can't crash the reduce.
 */
export function lengthDistance(entry: LibraryEntry, selectedBuckets: LengthBucket[]): number {
  const bucket = bucketOf(entry.length_hours);
  if (bucket === null || selectedBuckets.length === 0) {
    return NULL_DISTANCE;
  }
  const bg = LENGTH_BUCKET_BOUNDS[bucket].index;
  return Math.min(...selectedBuckets.map((s) => Math.abs(bg - LENGTH_BUCKET_BOUNDS[s].index)));
}

/**
 * The single hard filter, per mode (drives the empty-state):
 * - new modes (`new_releases`, `newly_bought`): exclude `completed_100` (a fully-finished game is
 *   never a "what's new" candidate); `completed` survives as a heavily-penalized candidate.
 * - `comfort`: exclude `not_played` (comfort means returning to something you've already touched).
 */
export function isEligible(entry: LibraryEntry, mode: NoveltyMode): boolean {
  if (mode === "comfort") {
    return entry.play_status !== "not_played";
  }
  return entry.play_status !== "completed_100";
}

/**
 * Completion/status penalty, normalized to [0, 1] (lower = better):
 * - new modes: `completed` ⇒ 1 (heavy), everything else ⇒ 0.
 * - `comfort`: graded ordering playing_now (0) < played (1/3) < completed (2/3) < completed_100 (1).
 *
 * Excluded statuses (defensive, never reached after {@link isEligible}) fall to the worst value.
 */
export function statusPenalty(entry: LibraryEntry, mode: NoveltyMode): number {
  if (mode === "comfort") {
    switch (entry.play_status) {
      case "playing_now":
        return 0;
      case "played":
        return 1 / 3;
      case "completed":
        return 2 / 3;
      default:
        return 1; // completed_100 (and, defensively, not_played)
    }
  }
  return entry.play_status === "completed" ? 1 : 0;
}

/**
 * The per-mode novelty axis as a numeric "goodness" (higher = more novel/better), so the rank
 * step can compare with plain numeric ops. Null dates are always worst (`-Infinity`).
 * - `new_releases`: newer `release_date` better ⇒ +epoch.
 * - `newly_bought`: newer `date_bought` (fallback `created_at`) better ⇒ +epoch.
 * - `comfort`: older `release_date` better ⇒ −epoch.
 */
function noveltyGoodness(entry: LibraryEntry, mode: NoveltyMode): number {
  if (mode === "newly_bought") {
    // created_at is non-null, so the fallback always yields a string.
    const epoch = Date.parse(entry.date_bought ?? entry.created_at);
    return Number.isNaN(epoch) ? -Infinity : epoch;
  }
  const epoch = entry.release_date === null ? NaN : Date.parse(entry.release_date);
  if (Number.isNaN(epoch)) {
    return -Infinity;
  }
  return mode === "comfort" ? -epoch : epoch;
}

/**
 * Rank-normalize the eligible set on the mode's axis to a [0, 1] novelty score per entry id
 * (higher = better). Entries sharing a raw axis value share a normalized rank (deterministic);
 * the worst distinct value maps to 0 and the best to 1, evenly spaced over the distinct values.
 * A set with a single distinct value (incl. a single entry) maps everything to 0 — irrelevant to
 * ordering, but defined.
 */
export function noveltyRank(entries: LibraryEntry[], mode: NoveltyMode): Map<string, number> {
  const goodness = new Map<string, number>();
  for (const entry of entries) {
    goodness.set(entry.id, noveltyGoodness(entry, mode));
  }

  const distinctSorted = [...new Set(goodness.values())].sort((a, b) => a - b);
  const position = new Map<number, number>();
  const divisor = distinctSorted.length - 1;
  distinctSorted.forEach((value, index) => {
    position.set(value, divisor > 0 ? index / divisor : 0);
  });

  const rank = new Map<string, number>();
  for (const [id, value] of goodness) {
    rank.set(id, position.get(value) ?? 0);
  }
  return rank;
}

/** Composite score (higher = better): −W_LEN·distance − W_COMP·statusPenalty + W_NOV·novelty. */
export function scoreOf(entry: LibraryEntry, request: RecommendationRequest, novelty: number): number {
  const distance = lengthDistance(entry, request.lengthBuckets);
  const status = statusPenalty(entry, request.mode);
  return -(W_LEN * distance) - W_COMP * status + W_NOV * novelty;
}

/**
 * Rank the user's eligible entries and return the top `limit`, or a structured empty-state.
 *
 * Pipeline: empty library ⇒ `empty_library`; else filter by mode eligibility; an empty eligible
 * set ⇒ `mode_eligibility`; else rank-normalize novelty over the eligible set, score each entry,
 * and sort descending with the created_at → id total-order tie-break (never relying on input
 * order). Pure and deterministic.
 */
export function recommend(entries: LibraryEntry[], request: RecommendationRequest, limit = 10): RecommendationResult {
  if (entries.length === 0) {
    return { status: "empty", reason: "empty_library", mode: request.mode };
  }

  const eligible = entries.filter((entry) => isEligible(entry, request.mode));
  if (eligible.length === 0) {
    return { status: "empty", reason: "mode_eligibility", mode: request.mode };
  }

  const noveltyByline = noveltyRank(eligible, request.mode);
  const scored: RecommendationItem[] = eligible.map((entry) => ({
    entry,
    score: scoreOf(entry, request, noveltyByline.get(entry.id) ?? 0),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score; // higher score first
    }
    if (a.entry.created_at !== b.entry.created_at) {
      return a.entry.created_at < b.entry.created_at ? -1 : 1; // oldest first
    }
    if (a.entry.id !== b.entry.id) {
      return a.entry.id < b.entry.id ? -1 : 1; // final guaranteed-unique key
    }
    return 0;
  });

  return { status: "ranked", items: scored.slice(0, limit) };
}

// --- Service entry point ---

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Load all of the signed-in user's entries (RLS-scoped) and delegate to {@link recommend}.
 * Errors propagate to the page's try/catch (mirroring `library/index.astro`).
 */
export async function getRecommendations(
  supabase: TypedSupabaseClient,
  request: RecommendationRequest,
  limit = 10,
): Promise<RecommendationResult> {
  const entries = await listAllEntries(supabase);
  return recommend(entries, request, limit);
}
