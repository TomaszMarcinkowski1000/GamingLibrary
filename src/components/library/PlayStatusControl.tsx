import { useRef, useState } from "react";
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
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { playStatusBadgeClass } from "./playStatus";
import { publishEntryPatch } from "./entrySync";

interface PlayStatusControlProps {
  entry: LibraryEntry;
}

/** Statuses that count as "finished" and trigger the optional play-time prompt (FR-014). */
const FINISHED_STATUSES = ["played", "completed", "completed_100"] as const satisfies readonly PlayStatus[];

function isFinishedStatus(status: PlayStatus): boolean {
  return (FINISHED_STATUSES as readonly PlayStatus[]).includes(status);
}

/**
 * Per-row interactive status cell (S-04): renders the entry's play status as a coloured badge that
 * opens a menu of the five statuses. Picking one updates the badge optimistically and persists via
 * `PATCH /api/library/[id]` — no page reload. On failure the badge reverts to its prior value and an
 * inline error shows beside it.
 *
 * Phase 3 (FR-014): picking a *finished* status (Played / Completed / 100% completed) still paints
 * the badge immediately, then opens a small popover offering an optional play-time-in-hours field.
 * Save folds `play_time_hours` into the same `PATCH`; Skip or dismiss commits the status alone. There
 * is always exactly one `PATCH` per status change — never a status write followed by a separate hours
 * write. Non-finished statuses keep the immediate-PATCH behaviour.
 *
 * The table stays server-rendered; only this cell hydrates (`client:visible`). Uses `fetch` directly,
 * matching `GameDialog` — there is no shared mutation hook.
 */
export default function PlayStatusControl({ entry }: PlayStatusControlProps) {
  const [status, setStatus] = useState<PlayStatus>(entry.play_status);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedHours, setSavedHours] = useState<number | null>(entry.play_time_hours);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [hoursInput, setHoursInput] = useState("");
  // The finished transition awaiting a popover decision. A ref (not state) so the Save/Skip handlers
  // can clear it synchronously before closing the popover — preventing the close-triggered dismiss
  // path from firing a second commit.
  const pendingTransitionRef = useRef<{ previous: PlayStatus; next: PlayStatus } | null>(null);
  // Set when a finished status is picked; consumed in the dropdown's onCloseAutoFocus to open the
  // hours popover only once the menu has fully closed (see selectStatus).
  const openPopoverOnMenuCloseRef = useRef(false);

  /** Persist a status change (optionally with hours). `hours === undefined` omits the field entirely. */
  async function commit(next: PlayStatus, previous: PlayStatus, hours: number | undefined) {
    setError(null);
    setPending(true);
    const body: { play_status: PlayStatus; play_time_hours?: number } = { play_status: next };
    if (hours !== undefined) {
      body.play_time_hours = hours;
    }
    try {
      const response = await fetch(`/api/library/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setStatus(previous);
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Couldn’t save. Try again.");
        return;
      }
      if (hours !== undefined) {
        setSavedHours(hours);
      }
      // Tell the row's other islands (the edit dialog) what we just persisted, so they don't show
      // stale values without a reload. Only include hours when they were actually written.
      publishEntryPatch(
        entry.id,
        hours !== undefined ? { play_status: next, play_time_hours: hours } : { play_status: next },
      );
    } catch {
      setStatus(previous);
      setError("Network error. Try again.");
    } finally {
      setPending(false);
    }
  }

  function selectStatus(next: PlayStatus) {
    if (next === status || pending) {
      return;
    }
    const previous = status;
    // Optimistic: paint the new badge immediately in every case.
    setStatus(next);
    setError(null);
    if (isFinishedStatus(next)) {
      // Defer the PATCH until the hours popover is resolved (Save / Skip / dismiss).
      pendingTransitionRef.current = { previous, next };
      setHoursInput(savedHours != null ? String(savedHours) : "");
      // Don't open the popover here: the menu is still closing this tick, and opening in the same
      // tick lets the menu's dismiss/focus teardown immediately close the popover. Open it from the
      // menu's onCloseAutoFocus instead, once the menu is fully gone.
      openPopoverOnMenuCloseRef.current = true;
      return;
    }
    void commit(next, previous, undefined);
  }

  /** Resolve the deferred finished transition exactly once, firing the single PATCH. */
  function resolveTransition(hours: number | undefined) {
    const transition = pendingTransitionRef.current;
    if (!transition) {
      return;
    }
    pendingTransitionRef.current = null;
    void commit(transition.next, transition.previous, hours);
  }

  function handleSave() {
    const trimmed = hoursInput.trim();
    let hours: number | undefined;
    if (trimmed !== "") {
      const parsed = Math.trunc(Number(trimmed));
      hours = Number.isFinite(parsed) ? parsed : undefined;
    }
    // Resolve before closing so the close-triggered onOpenChange sees a cleared ref and no-ops.
    resolveTransition(hours);
    setPopoverOpen(false);
  }

  function handleSkip() {
    resolveTransition(undefined);
    setPopoverOpen(false);
  }

  function handleOpenChange(open: boolean) {
    setPopoverOpen(open);
    if (!open) {
      // Dismiss (escape / outside click) commits the status alone; a no-op if Save/Skip already ran.
      resolveTransition(undefined);
    }
  }

  return (
    <Popover open={popoverOpen} onOpenChange={handleOpenChange}>
      <div className="flex items-center gap-2">
        <PopoverAnchor className="inline-flex">
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
            <DropdownMenuContent
              align="start"
              // Fires once the menu has fully closed. If a finished status was just picked, open the
              // hours popover *now* (not in selectStatus) — by this point the menu's dismiss layer is
              // gone, so it can't immediately close the popover. preventDefault stops focus returning
              // to the trigger (a focus-move outside the popover that Radix would read as a dismiss);
              // the popover's own open-autofocus takes focus instead.
              onCloseAutoFocus={(event) => {
                if (openPopoverOnMenuCloseRef.current) {
                  openPopoverOnMenuCloseRef.current = false;
                  event.preventDefault();
                  setPopoverOpen(true);
                }
              }}
            >
              <DropdownMenuRadioGroup
                value={status}
                onValueChange={(value) => {
                  selectStatus(value as PlayStatus);
                }}
              >
                {PLAY_STATUSES.map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {PLAY_STATUS_LABELS[value]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </PopoverAnchor>
        {error && <span className="text-destructive text-xs">{error}</span>}
      </div>
      <PopoverContent align="start" className="w-56 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`play-time-${entry.id}`}>Play time (hours)</Label>
          <Input
            id={`play-time-${entry.id}`}
            type="number"
            min={0}
            autoFocus
            value={hoursInput}
            onChange={(event) => {
              setHoursInput(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSave();
              }
            }}
          />
          <p className="text-muted-foreground text-xs">Optional — leave blank to skip.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={handleSkip}>
            Skip
          </Button>
          <Button type="button" size="sm" onClick={handleSave}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
