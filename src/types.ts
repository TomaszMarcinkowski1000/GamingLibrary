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

// --- Metadata enrichment status ---

export const METADATA_STATUSES = ["matched", "no_match"] as const;

export type MetadataStatus = (typeof METADATA_STATUSES)[number];

// --- IGDB lookup result (F-02) ---

/**
 * Discriminated result of `lookupGameMetadata(title, platform, kv)`.
 *
 * `matched` carries the five required metadata fields (genre, length, release year,
 * developer, release date) plus the folded-in `series`. Field nullability mirrors IGDB
 * coverage — `series` and `lengthHours` are the most likely to be absent. A `no_match`
 * is a returned value, never a throw.
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
