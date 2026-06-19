import type { Database } from "@/db/database.types";

/**
 * Shared domain types for Gaming Library.
 *
 * Entity + DTO types are derived from the generated DB row types
 * (`src/db/database.types.ts`) so they can't silently drift from the schema.
 * Regenerate the source types after any migration with `npm run db:types`.
 */

// --- Library entry entity + DTOs ---

export type LibraryEntry = Omit<
  Database["public"]["Tables"]["library_entries"]["Row"],
  "play_status" | "metadata_status"
> & {
  play_status: PlayStatus;
  metadata_status: MetadataStatus | null;
};
export type LibraryEntryInsert = Database["public"]["Tables"]["library_entries"]["Insert"];
export type LibraryEntryUpdate = Database["public"]["Tables"]["library_entries"]["Update"];

// --- Play status ---

export const PLAY_STATUSES = ["not_played", "playing_now", "played", "completed", "completed_100"] as const;

export type PlayStatus = (typeof PLAY_STATUSES)[number];

/** User-facing display labels for each play status (PRD wording). */
export const PLAY_STATUS_LABELS: Record<PlayStatus, string> = {
  not_played: "Not played",
  playing_now: "Playing now",
  played: "Played",
  completed: "Completed",
  completed_100: "100% completed",
};

// --- Library browse: sort, filters, facets (S-06) ---

/**
 * Sort vocabulary for the library browse view. Each key maps to the `library_entries`
 * column and direction the service passes to `.order()`. `added_desc` (newest first) is
 * the default and matches the pre-S-06 fixed ordering. The page validates the `?sort`
 * param against these keys and falls back to {@link DEFAULT_LIBRARY_SORT}.
 */
export const LIBRARY_SORTS = {
  added_desc: { label: "Date added (newest)", column: "created_at", ascending: false },
  added_asc: { label: "Date added (oldest)", column: "created_at", ascending: true },
  title_asc: { label: "Title (A–Z)", column: "title", ascending: true },
  title_desc: { label: "Title (Z–A)", column: "title", ascending: false },
  year_desc: { label: "Release year (newest)", column: "release_year", ascending: false },
  year_asc: { label: "Release year (oldest)", column: "release_year", ascending: true },
} as const satisfies Record<string, { label: string; column: string; ascending: boolean }>;

export type LibrarySort = keyof typeof LIBRARY_SORTS;

export const DEFAULT_LIBRARY_SORT: LibrarySort = "added_desc";

/** A single facet option: an owned value plus how many of the user's entries match it. */
export interface FacetValue {
  value: string;
  count: number;
}

/**
 * Owned-only filter options with per-value counts for each filterable dimension,
 * sourced from the `library_facets()` RPC. `statuses` carries only the statuses present
 * in the library; the page zero-fills the five canonical {@link PLAY_STATUSES}.
 */
export interface LibraryFacets {
  platforms: FacetValue[];
  genres: FacetValue[];
  series: FacetValue[];
  statuses: FacetValue[];
}

/**
 * Selected filter values per dimension. Within a dimension values combine as OR; across
 * dimensions as AND (and AND with the title search). An absent/empty array = no filter on
 * that dimension. Scalar columns (`statuses`, `platforms`) match with `.in()`; array
 * columns (`genres`, `series`) match with `.overlaps()`.
 */
export interface LibraryFilters {
  statuses?: PlayStatus[];
  platforms?: string[];
  genres?: string[];
  series?: string[];
}

// --- Metadata enrichment status ---

export const METADATA_STATUSES = ["matched", "no_match"] as const;

export type MetadataStatus = (typeof METADATA_STATUSES)[number];

// --- "What should I play next?" recommendation (S-07) ---

/**
 * Overall game-length buckets, ordinal short → very_long. The recommender's length dial is a
 * multi-select over these; the engine measures bucket *distance* so out-of-bucket games degrade
 * gracefully rather than disappearing. Boundaries are inclusive-low / exclusive-high (see
 * {@link LENGTH_BUCKET_BOUNDS}).
 */
export const LENGTH_BUCKETS = ["short", "medium", "long", "very_long"] as const;

export type LengthBucket = (typeof LENGTH_BUCKETS)[number];

/**
 * `[minHours, maxHours)` bounds per bucket, with the ordinal index used for distance math.
 * `maxHours: null` means open-ended (very_long, 60h+). A `length_hours` of exactly a boundary
 * value lands in the higher bucket (10 → medium, 30 → long, 60 → very_long).
 */
export const LENGTH_BUCKET_BOUNDS: Record<LengthBucket, { index: number; minH: number; maxH: number | null }> = {
  short: { index: 0, minH: 0, maxH: 10 },
  medium: { index: 1, minH: 10, maxH: 30 },
  long: { index: 2, minH: 30, maxH: 60 },
  very_long: { index: 3, minH: 60, maxH: null },
};

/** User-facing display labels for each length bucket. */
export const LENGTH_BUCKET_LABELS: Record<LengthBucket, string> = {
  short: "Short (under 10h)",
  medium: "Medium (10–30h)",
  long: "Long (30–60h)",
  very_long: "Very long (60h+)",
};

/**
 * Novelty modes — the single-select bias the recommender applies on top of the length dial.
 * `new_releases` favors recently-released games, `newly_bought` recently-acquired ones, and
 * `comfort` old favorites you've already touched. Each mode also drives a hard eligibility
 * filter (see the engine), which is what can produce the explanatory empty-state.
 */
export const NOVELTY_MODES = ["new_releases", "newly_bought", "comfort"] as const;

export type NoveltyMode = (typeof NOVELTY_MODES)[number];

/** User-facing display labels for each novelty mode. */
export const NOVELTY_MODE_LABELS: Record<NoveltyMode, string> = {
  new_releases: "New releases",
  newly_bought: "Newly bought",
  comfort: "Comfort",
};

/** Normalized recommendation request: which length buckets are selected, and the novelty mode. */
export interface RecommendationRequest {
  lengthBuckets: LengthBucket[];
  mode: NoveltyMode;
}

/** A single ranked result: the entry plus its composite score (higher = better). */
export interface RecommendationItem {
  entry: LibraryEntry;
  score: number;
}

/**
 * Why the recommendation came back empty. `empty_library` ⇒ the user has no entries at all;
 * `mode_eligibility` ⇒ the selected mode's hard filter excluded every entry (length never
 * empties the set — it's a graded soft penalty — so it is never the binding constraint).
 */
export type EmptyReason = "empty_library" | "mode_eligibility";

/**
 * Discriminated recommendation result: a `ranked` list (top N) or an `empty` state carrying the
 * binding reason and the mode (so the page can render mode-specific relaxation copy).
 */
export type RecommendationResult =
  | { status: "ranked"; items: RecommendationItem[] }
  | { status: "empty"; reason: EmptyReason; mode: NoveltyMode };

// --- IGDB lookup result (F-02) ---

/**
 * Discriminated result of `lookupGameMetadata(title, platform, kv)`.
 *
 * `matched` carries the five required metadata fields (genre, length, release year,
 * developer, release date) plus the folded-in `series`. Field nullability mirrors IGDB
 * coverage — `series` and `lengthHours` are the most likely to be absent. A `no_match`
 * is a returned value, never a throw.
 *
 * `collapsedFrom` is a diagnostic-only field (the edition candidate id this collapsed
 * *from*, or `null` when the top candidate was already the base). It exists solely so the
 * F-03 accuracy harness can print a per-case collapse note; production consumers ignore it
 * and it never participates in the `matched | no_match` discriminant.
 */
export type IgdbLookupResult =
  | {
      status: "matched";
      igdbId: number;
      genre: string[];
      developer: string[];
      series: string[];
      releaseYear: number | null;
      releaseDate: string | null;
      lengthHours: number | null;
      collapsedFrom?: number | null;
    }
  | { status: "no_match" };

// --- Vision identification result (F-03 spike) ---

/**
 * Discriminated result of `identifyGameFromPhoto(imageDataUrl)`.
 *
 * `identified` carries the model's proposed title + platform and its self-reported
 * confidence. `unsure` is the explicit abstain — emitted when confidence falls below the
 * service's threshold (the harness scores abstains separately from wrong answers). The
 * discriminant field name `status` matches {@link IgdbLookupResult}.
 */
export type VisionIdentifyResult =
  | { status: "identified"; title: string; platform: string; confidence: number }
  | { status: "unsure"; confidence: number };

// --- /api/identify response contract (S-03) ---

/**
 * The `POST /api/identify` response, shared by the route and the PhotoCapture island so the two
 * cannot drift. `identified` carries the grounded `igdbId` (null only when IGDB transport failed or
 * grounding missed); on the persist path it also carries the created `entry`. `unsure` is the explicit
 * abstain that routes to manual add. `debug` is diagnostic-only (the accuracy harness prints a
 * per-case collapse note); it is never a scored field and the island ignores it.
 */
export type IdentifyResponse =
  | {
      status: "identified";
      title: string;
      platform: string;
      confidence: number;
      igdbId: number | null;
      metadataStatus: MetadataStatus | null;
      debug?: { collapsedFrom: number | null };
      entry?: LibraryEntry;
    }
  | { status: "unsure"; confidence: number };
