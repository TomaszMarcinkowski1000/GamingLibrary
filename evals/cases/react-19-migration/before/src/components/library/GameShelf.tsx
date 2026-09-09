import * as React from "react";
import { cn } from "@/lib/utils";
import { formatEntryLabel } from "@/lib/format";
import { announceSelection, fetchShelf, subscribeToShelf } from "@/lib/services/shelf";
import type { LibraryEntry, PlayStatus } from "@/types";

interface ShelfCardProps {
  entry: LibraryEntry;
  onSelect: (entry: LibraryEntry) => void;
}

/**
 * One card on the shelf. The shelf holds a ref to the most recently added card so it can scroll
 * it into view, which is why this is wrapped rather than a plain function component.
 */
const ShelfCard = React.forwardRef<HTMLLIElement, ShelfCardProps>(function ShelfCard({ entry, onSelect }, ref) {
  const label = React.useMemo(() => formatEntryLabel(entry), [entry]);

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
      {entry.notes === null ? null : <p className="px-3 pb-3 text-sm text-muted-foreground">{entry.notes}</p>}
    </li>
  );
});

interface GameShelfProps {
  userId: string;
  status: PlayStatus;
  /** How many entries to request. Defaults to a single screenful. */
  pageSize?: number;
}

interface GameShelfState {
  entries: LibraryEntry[];
  loading: boolean;
  error: string | null;
}

/**
 * The user's shelf for one play status.
 *
 * Refetches when `status` or `pageSize` changes, and when another tab reports a mutation. Every
 * fetch is bound to an `AbortController` so a refetch — or an unmount — cancels the one in flight
 * rather than letting it land on a component that is no longer mounted.
 */
export class GameShelf extends React.Component<GameShelfProps, GameShelfState> {
  static defaultProps = {
    pageSize: 24,
  };

  state: GameShelfState = { entries: [], loading: true, error: null };

  private controller: AbortController | null = null;
  private unsubscribe: (() => void) | null = null;

  componentDidMount() {
    this.load();
    this.unsubscribe = subscribeToShelf(this.props.userId, () => {
      this.load();
    });
  }

  componentDidUpdate(previous: GameShelfProps) {
    if (previous.status !== this.props.status || previous.pageSize !== this.props.pageSize) {
      this.load();
    }
  }

  componentWillUnmount() {
    this.controller?.abort();
    this.unsubscribe?.();
  }

  handleSelect = (entry: LibraryEntry) => {
    announceSelection(entry.id);
  };

  load() {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    this.setState({ loading: true, error: null });

    fetchShelf(
      { userId: this.props.userId, status: this.props.status, pageSize: this.props.pageSize! },
      controller.signal,
    )
      .then((entries) => {
        this.setState({ entries, loading: false });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        this.setState({
          error: cause instanceof Error ? cause.message : "Could not load your shelf.",
          loading: false,
        });
      });
  }

  render() {
    const { entries, loading, error } = this.state;

    if (loading) {
      return <p className="p-4 text-sm text-muted-foreground">Loading your shelf…</p>;
    }

    if (error !== null) {
      return <p className="p-4 text-sm text-destructive">{error}</p>;
    }

    return (
      <ul className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        {entries.map((entry) => (
          <ShelfCard key={entry.id} entry={entry} onSelect={this.handleSelect} />
        ))}
      </ul>
    );
  }
}
