import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LibraryEntry, PlayStatus } from "@/types";
import { PLAY_STATUS_LABELS, PLAY_STATUSES } from "@/types";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { playStatusBadgeClass } from "./playStatus";

interface PlayStatusControlProps {
  entry: LibraryEntry;
}

/**
 * Per-row interactive status cell (S-04 Phase 2): renders the entry's play status as a coloured
 * badge that opens a menu of the five statuses. Picking one updates the badge optimistically and
 * persists via `PATCH /api/library/[id]` — no page reload. On failure the badge reverts to its
 * prior value and an inline error shows beside it.
 *
 * The table stays server-rendered; only this cell hydrates (`client:visible`). Uses `fetch`
 * directly, matching `GameDialog` — there is no shared mutation hook. (Phase 3 extends this with
 * the optional play-time popover for finished statuses.)
 */
export default function PlayStatusControl({ entry }: PlayStatusControlProps) {
  const [status, setStatus] = useState<PlayStatus>(entry.play_status);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeStatus(next: PlayStatus) {
    if (next === status || pending) {
      return;
    }
    const previous = status;
    // Optimistic: paint the new badge immediately, then persist in the background.
    setStatus(next);
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/library/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ play_status: next }),
      });
      if (!response.ok) {
        setStatus(previous);
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Couldn’t save. Try again.");
      }
    } catch {
      setStatus(previous);
      setError("Network error. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-opacity",
            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            "disabled:opacity-60",
            playStatusBadgeClass(status),
          )}
        >
          {PLAY_STATUS_LABELS[status]}
          <ChevronDown className="size-3 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={status} onValueChange={(value) => void changeStatus(value as PlayStatus)}>
            {PLAY_STATUSES.map((value) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {PLAY_STATUS_LABELS[value]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <span className="text-destructive text-xs">{error}</span>}
    </div>
  );
}
