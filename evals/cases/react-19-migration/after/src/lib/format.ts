import type { LibraryEntry } from "@/types";
import { PLAY_STATUS_LABELS } from "@/types";

/**
 * The one-line caption under a shelf card: platform, release year when known, and the play
 * status in PRD wording. Pure string work — no allocation worth memoising.
 */
export function formatEntryLabel(entry: LibraryEntry): string {
  const year = entry.release_year === null ? "" : ` · ${String(entry.release_year)}`;
  return `${entry.platform}${year} · ${PLAY_STATUS_LABELS[entry.play_status]}`;
}
