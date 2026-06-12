import { useState, type ReactNode } from "react";
import type { LibraryEntry } from "@/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface DeleteEntryDialogProps {
  entry: Pick<LibraryEntry, "id" | "title">;
  /** The element that opens the confirm — rendered inside `AlertDialogTrigger asChild`. */
  trigger: ReactNode;
  /** Runs after a successful delete. Defaults to reloading the page (preserving `?page`). */
  onDeleted?: () => void;
}

/**
 * The single FR-020 confirmation surface, reused by both the per-row Delete and the
 * in-dialog Delete. Built on shadcn `AlertDialog`.
 *
 * Open state is controlled so a failed delete keeps the dialog open with an inline error
 * (the default AlertDialogAction would close on click). On success, `onDeleted` runs —
 * defaulting to a reload so the SSR list reflects the removal.
 */
export function DeleteEntryDialog({ entry, trigger, onDeleted }: DeleteEntryDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/library/${entry.id}`, { method: "DELETE" });
      if (!response.ok) {
        setError("Couldn’t delete this entry. Please try again.");
        return;
      }
      if (onDeleted) {
        onDeleted();
      } else {
        // Preserve ?page — reload re-runs the SSR list query for the current page.
        window.location.reload();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{entry.title}”?</AlertDialogTitle>
          <AlertDialogDescription>This can’t be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(event) => {
              // Keep the dialog open while the async delete runs / on failure.
              event.preventDefault();
              void handleDelete();
            }}
          >
            {pending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
