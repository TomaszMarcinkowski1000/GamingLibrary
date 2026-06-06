import type { Database } from "@/db/database.types";

/**
 * Shared domain types for Gaming Library.
 *
 * Entity + DTO types are derived from the generated DB row types
 * (`src/db/database.types.ts`) so they can't silently drift from the schema.
 * Regenerate the source types after any migration with `npm run db:types`.
 */

// --- Library entry entity + DTOs ---

export type LibraryEntry = Database["public"]["Tables"]["library_entries"]["Row"];
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
