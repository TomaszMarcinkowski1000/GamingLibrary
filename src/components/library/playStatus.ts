import type { PlayStatus } from "@/types";

/**
 * Tailwind badge class set per play status (S-04), in the existing cosmic palette.
 *
 * Centralized so the SSR initial render and the hydrated `PlayStatusControl` island agree on
 * the colour for a given status. Labels come from `PLAY_STATUS_LABELS` (`src/types.ts`) — this
 * map owns colour only. Neutral for `not_played`, a sky accent for `playing_now`, green success
 * tones for played → completed, and a prestige violet for `completed_100` (the top tier) — kept off
 * amber/yellow so 100% reads as an achievement, not a warning.
 */
const PLAY_STATUS_BADGE_CLASS: Record<PlayStatus, string> = {
  not_played: "bg-white/10 text-blue-100/70 border border-white/15",
  playing_now: "bg-sky-500/15 text-sky-200 border border-sky-400/30",
  played: "bg-emerald-500/15 text-emerald-200 border border-emerald-400/30",
  completed: "bg-green-500/20 text-green-200 border border-green-400/40",
  completed_100: "bg-violet-500/20 text-violet-200 border border-violet-400/40",
};

/** Badge classes for a status — used by both the SSR cell and the island. */
export function playStatusBadgeClass(status: PlayStatus): string {
  return PLAY_STATUS_BADGE_CLASS[status];
}
