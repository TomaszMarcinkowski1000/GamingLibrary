import type { PlayStatus } from "@/types";

/**
 * Cross-island entry sync (S-04 Phase 3).
 *
 * The library list is server-rendered; each row hydrates several *independent* islands that each
 * received their own copy of the row's `entry` from the server. When `PlayStatusControl` mutates
 * status/play-time inline (no page reload), the row's edit dialog (`GameDialog`, a separate island)
 * would otherwise keep showing the stale server values until a refresh.
 *
 * This is a minimal module-level pub/sub keyed by entry id. Astro/Vite bundles shared modules into
 * one browser instance, so this `bus` is a singleton across every island on the page (the same
 * mechanism nanostores relies on). The inline control publishes the fields it committed; the dialog
 * subscribes and merges them. One direction only — the dialog's own saves reload the page.
 */
export interface EntryPatch {
  play_status?: PlayStatus;
  play_time_hours?: number | null;
}

const bus = new EventTarget();

/** Broadcast the fields just persisted for `id` so other islands for the same row can stay in sync. */
export function publishEntryPatch(id: string, patch: EntryPatch): void {
  bus.dispatchEvent(new CustomEvent<EntryPatch>(`entry:${id}`, { detail: patch }));
}

/** Subscribe to committed patches for `id`. Returns an unsubscribe function. */
export function subscribeEntryPatch(id: string, handler: (patch: EntryPatch) => void): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<EntryPatch>).detail);
  };
  bus.addEventListener(`entry:${id}`, listener);
  return () => {
    bus.removeEventListener(`entry:${id}`, listener);
  };
}
