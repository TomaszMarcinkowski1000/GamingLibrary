/**
 * Shared domain types for the library shelf.
 *
 * Mirrors the shapes `src/types.ts` derives from the generated Supabase row types; this slice
 * carries only what the shelf renders.
 */

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

export interface LibraryEntry {
  id: string;
  title: string;
  platform: string;
  release_year: number | null;
  cover_url: string | null;
  play_status: PlayStatus;
  /**
   * Free text the owner types into the entry dialog. Stored verbatim — the API applies no
   * sanitisation, and RLS is the only thing scoping it to its owner.
   */
  notes: string | null;
  created_at: string;
}
