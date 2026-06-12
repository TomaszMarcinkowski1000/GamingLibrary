import { Trash2 } from "lucide-react";
import type { LibraryEntry } from "@/types";
import { Button } from "@/components/ui/button";
import GameDialog from "./GameDialog";
import { DeleteEntryDialog } from "./DeleteEntryDialog";

interface EntryRowActionsProps {
  entry: LibraryEntry;
  platformOptions: string[];
}

/**
 * Per-row interactive surface (S-02 Phase 3): an Edit trigger that opens `GameDialog` in edit
 * mode for this entry, and a Delete trigger that opens `DeleteEntryDialog`. The table itself
 * stays server-rendered; only this cell hydrates (`client:visible`).
 *
 * Both dialogs default their success handler to reloading the current page (preserving `?page`),
 * so the authoritative SSR list reflects the mutation.
 */
export function EntryRowActions({ entry, platformOptions }: EntryRowActionsProps) {
  return (
    <div className="flex items-center justify-end gap-1">
      <GameDialog entry={entry} platformOptions={platformOptions} />
      <DeleteEntryDialog
        entry={entry}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete"
            title="Delete"
            className="size-8 text-blue-100/70 hover:bg-red-500/15 hover:text-red-300"
          >
            <Trash2 />
          </Button>
        }
      />
    </div>
  );
}
