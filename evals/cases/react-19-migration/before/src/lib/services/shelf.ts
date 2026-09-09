import type { LibraryEntry, PlayStatus } from "@/types";

export interface ShelfQuery {
  userId: string;
  status: PlayStatus;
  pageSize: number;
}

/**
 * `GET /api/library` for one play status. The endpoint reads the caller's session cookie and
 * Postgres RLS scopes the rows, so `userId` never travels in the query string — it is here only
 * because the realtime channel below is keyed by it.
 */
export async function fetchShelf(query: ShelfQuery, signal: AbortSignal): Promise<LibraryEntry[]> {
  const params = new URLSearchParams({
    status: query.status,
    limit: String(query.pageSize),
  });

  const response = await fetch(`/api/library?${params.toString()}`, { signal });
  if (!response.ok) {
    throw new Error(`Library request failed with ${String(response.status)}`);
  }

  const body: { entries: LibraryEntry[] } = await response.json();
  return body.entries;
}

/**
 * Subscribe to shelf mutations made in another tab (add, delete, status change) so the open
 * shelf refetches. Returns the unsubscribe handle; the channel stays open and keeps firing
 * `onChange` until it is called.
 */
export function subscribeToShelf(userId: string, onChange: () => void): () => void {
  const channel = new BroadcastChannel(`library:${userId}`);
  channel.onmessage = () => {
    onChange();
  };
  return () => {
    channel.close();
  };
}

/**
 * Announce a card selection to the host page. The shelf is mounted from outside the React tree and
 * has no callback prop to hand back across that boundary, so selection travels as a DOM event.
 */
export function announceSelection(entryId: string): void {
  document.dispatchEvent(new CustomEvent("shelf:select", { detail: entryId }));
}
