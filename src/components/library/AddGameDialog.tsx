import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GameFormFields, type GameFormValues } from "./GameFormFields";

interface AddGameDialogProps {
  platformOptions: string[];
  /** Trigger label — defaults to "Add game"; the empty-state passes "Add your first game". */
  triggerLabel?: string;
  /** Trigger size — the empty-state uses "lg" for a more prominent CTA. */
  triggerSize?: "default" | "lg";
}

const EMPTY: GameFormValues = { title: "", platform: "" };

/**
 * The interactive Add-game surface (S-01) launched from the library page.
 *
 * Owns the dialog shell, client-side validation, the create call, and the Save vs
 * Save-&-add-another flows. Wraps the presentational `GameFormFields`, so when S-02 grows
 * that body and adds an UPDATE path this shell becomes the unified add/edit dialog. The
 * post-save behavior is funneled through a single `save()` seam, so S-02 can swap
 * "close + navigate" for "reopen in edit mode" in one place.
 */
export default function AddGameDialog({
  platformOptions,
  triggerLabel = "Add game",
  triggerSize = "default",
}: AddGameDialogProps) {
  const [open, setOpen] = useState(false);
  // Options are session-mutable: a freshly-created platform is appended so it's immediately
  // reusable across "Save & add another" rounds without a round-trip.
  const [options, setOptions] = useState<string[]>(platformOptions);
  const [values, setValues] = useState<GameFormValues>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Did this dialog session persist at least one entry? "Save & add another" keeps the
  // dialog open over a stale list, so on close we must refresh to reflect what was added.
  const [savedSinceOpen, setSavedSinceOpen] = useState(false);
  // Captured as state (not a ref) so the popover container is set before the user opens
  // the combobox — letting it portal inside the dialog's scroll-lock subtree.
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  function reset() {
    setValues(EMPTY);
    setErrors({});
    setServerError(null);
  }

  function patchValues(patch: Partial<GameFormValues>) {
    setValues((prev) => ({ ...prev, ...patch }));
    // Clear any error on a field the user is now editing.
    setErrors((prev) => {
      const edited = new Set(Object.keys(patch));
      return Object.fromEntries(Object.entries(prev).filter(([key]) => !edited.has(key)));
    });
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!values.title.trim()) {
      next.title = "Title is required";
    }
    if (!values.platform.trim()) {
      next.platform = "Platform is required";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function rememberPlatform(platform: string) {
    const value = platform.trim();
    if (!value) {
      return;
    }
    setOptions((prev) =>
      prev.some((option) => option.toLowerCase() === value.toLowerCase()) ? prev : [...prev, value],
    );
  }

  /** The single post-save seam: validate, POST, surface errors. Returns true on a saved entry. */
  async function save(): Promise<boolean> {
    setServerError(null);
    if (!validate()) {
      return false;
    }
    setPending(true);
    try {
      const response = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: values.title.trim(), platform: values.platform.trim() }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setServerError(data?.error ?? "Something went wrong. Please try again.");
        return false;
      }
      rememberPlatform(values.platform);
      setSavedSinceOpen(true);
      return true;
    } catch {
      setServerError("Network error. Please try again.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function handleSave() {
    if (await save()) {
      // Navigate to page 1 so the new (newest) entry lands on top of the list.
      window.location.assign("/library");
    }
  }

  async function handleSaveAndAddAnother() {
    if (await save()) {
      reset();
      titleRef.current?.focus();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSavedSinceOpen(false);
        } else if (savedSinceOpen) {
          // Refresh so entries added via "Save & add another" appear in the list.
          window.location.assign("/library");
        } else {
          reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size={triggerSize}>
          <Plus />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent ref={setContentEl}>
        <DialogHeader>
          <DialogTitle>Add a game</DialogTitle>
          <DialogDescription>Enter a title and platform — we’ll fetch its metadata automatically.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <GameFormFields
            values={values}
            onChange={patchValues}
            errors={errors}
            platformOptions={options}
            titleRef={titleRef}
            platformContainer={contentEl}
          />
          {serverError && <p className="text-destructive text-sm">{serverError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => void handleSaveAndAddAnother()}>
              Save &amp; add another
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
