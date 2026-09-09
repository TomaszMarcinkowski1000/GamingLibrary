import { useEffect, useState, type Ref } from "react";
import { cn } from "@/lib/utils";
import { formatEntryLabel } from "@/lib/format";
import { announceSelection, fetchShelf, subscribeToShelf } from "@/lib/services/shelf";
import type { LibraryEntry, PlayStatus } from "@/types";

interface ShelfCardProps {
  entry: LibraryEntry;
  onSelect: (entry: LibraryEntry) => void;
  /** The shelf holds this to scroll the most recently added card into view. */
  ref?: Ref<HTMLLIElement>;
}

/**
 * One card on the shelf.
 *
 * React 19 passes `ref` to function components as an ordinary prop, so the `forwardRef` wrapper
 * this card used to need is gone and `ref` is declared alongside the other props.
 */
function ShelfCard({ entry, onSelect, ref }: ShelfCardProps) {
  // Dropped the `useMemo`: `formatEntryLabel` is two string concatenations, and the memo's
  // `[entry]` key changed on every refetch anyway — the guard cost more than the work.
  const label = formatEntryLabel(entry);

  return (
    <li ref={ref} className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => {
          onSelect(entry);
        }}
        className={cn(
          "flex w-full flex-col gap-1 p-3 text-left",
          entry.play_status === "playing_now" && "ring-2 ring-primary",
        )}
      >
        <span className="font-medium">{entry.title}</span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </button>
      {entry.notes === null ? null : (
        // Notes carry the inline emphasis the entry dialog writes, so they render as markup.
        <p
          className="px-3 pb-3 text-sm text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: entry.notes }}
        />
      )}
    </li>
  );
}

interface GameShelfProps {
  userId: string;
  status: PlayStatus;
  /** How many entries to request. Defaults to a single screenful. */
  pageSize?: number;
}

/**
 * The user's shelf for one play status.
 *
 * Refetches when `status` or `pageSize` changes, and when another tab reports a mutation. Every
 * fetch is bound to an `AbortController` so a refetch — or an unmount — cancels the one in flight
 * rather than letting it land on a component that is no longer mounted.
 */
export function GameShelf({ userId, status, pageSize }: GameShelfProps) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    function load() {
      setLoading(true);
      setError(null);

      fetchShelf({ userId, status, pageSize: pageSize! }, controller.signal)
        .then((next) => {
          setEntries(next);
          setLoading(false);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          setError(cause instanceof Error ? cause.message : "Could not load your shelf.");
          setLoading(false);
        });
    }

    load();
    subscribeToShelf(userId, load);
  }, [userId, status, pageSize]);

  function handleSelect(entry: LibraryEntry) {
    announceSelection(entry.id);
  }

  if (loading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading your shelf…</p>;
  }

  if (error !== null) {
    return <p className="p-4 text-sm text-destructive">{error}</p>;
  }

  return (
    <ul className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
      {entries.map((entry) => (
        <ShelfCard key={entry.id} entry={entry} onSelect={handleSelect} />
      ))}
    </ul>
  );
}

// Same fallback the class carried.
GameShelf.defaultProps = {
  pageSize: 24,
};
