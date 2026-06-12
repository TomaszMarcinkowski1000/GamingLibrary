import { useRef, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import type { IgdbLookupResult, LibraryEntry } from "@/types";
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
import { DeleteEntryDialog } from "./DeleteEntryDialog";

interface GameDialogProps {
  platformOptions: string[];
  /** Trigger label (add mode) — defaults to "Add game"; the empty-state passes "Add your first game". */
  triggerLabel?: string;
  /** Trigger size — the empty-state uses "lg" for a more prominent CTA. */
  triggerSize?: "default" | "lg";
  /** Present → edit mode (pre-fill from this entry, PUT on save, in-dialog Delete). Absent → add mode. */
  entry?: LibraryEntry;
}

const EMPTY: GameFormValues = {
  title: "",
  platform: "",
  play_status: "not_played",
  play_time_hours: null,
  date_bought: null,
  genre: [],
  developer: [],
  series: [],
  length_hours: null,
  release_year: null,
  release_date: null,
  igdb_id: null,
  metadata_status: null,
};

/** Row → form: nulls preserved, array fields default to `[]`. */
function mapEntryToValues(entry: LibraryEntry): GameFormValues {
  return {
    title: entry.title,
    platform: entry.platform,
    play_status: entry.play_status,
    play_time_hours: entry.play_time_hours,
    date_bought: entry.date_bought,
    genre: entry.genre ?? [],
    developer: entry.developer ?? [],
    series: entry.series ?? [],
    length_hours: entry.length_hours,
    release_year: entry.release_year,
    release_date: entry.release_date,
    igdb_id: entry.igdb_id,
    metadata_status: entry.metadata_status,
  };
}

/** Form → PUT body: the full editable field set, matching `updateEntrySchema`. */
function mapValuesToBody(values: GameFormValues) {
  return {
    title: values.title.trim(),
    platform: values.platform.trim(),
    play_status: values.play_status,
    play_time_hours: values.play_time_hours,
    date_bought: values.date_bought,
    genre: values.genre,
    developer: values.developer,
    series: values.series,
    length_hours: values.length_hours,
    release_year: values.release_year,
    release_date: values.release_date,
    igdb_id: values.igdb_id,
    metadata_status: values.metadata_status,
  };
}

/**
 * The single dialog for both add and edit (S-02), grown from S-01's `AddGameDialog` per the
 * roadmap design note ("unified add/edit dialog, not a separate edit screen").
 *
 * Add mode (no `entry`) is byte-for-byte S-01: title + platform, POST `/api/library`, Save /
 * Save-&-add-another. Edit mode (with `entry`) pre-fills the full field set, PUTs the whole row
 * (last-write-wins), offers an in-dialog Delete and a Re-fetch-metadata button, and drops
 * "Save & add another". Both funnel persistence through the single `save()` seam.
 */
export default function GameDialog({
  platformOptions,
  triggerLabel = "Add game",
  triggerSize = "default",
  entry,
}: GameDialogProps) {
  const [open, setOpen] = useState(false);
  // After a successful ADD we keep this dialog open and flip it into edit mode, pre-filled with the
  // freshly-enriched entry so the user can review/correct IGDB's result — the S-01 post-save seam
  // realized ("reopen the just-saved entry in edit mode"). `entry` (a true edit) takes precedence;
  // `savedEntry` is the in-place add→edit transition.
  const [savedEntry, setSavedEntry] = useState<LibraryEntry | undefined>(undefined);
  const activeEntry = entry ?? savedEntry;
  const isEdit = activeEntry !== undefined;
  // Options are session-mutable: a freshly-created platform is appended so it's immediately
  // reusable across "Save & add another" rounds without a round-trip.
  const [options, setOptions] = useState<string[]>(platformOptions);
  const [values, setValues] = useState<GameFormValues>(entry ? mapEntryToValues(entry) : EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Did this dialog session persist at least one entry? "Save & add another" keeps the
  // dialog open over a stale list, so on close we must refresh to reflect what was added.
  const [savedSinceOpen, setSavedSinceOpen] = useState(false);
  const [refetchPending, setRefetchPending] = useState(false);
  const [refetchNoMatch, setRefetchNoMatch] = useState(false);
  // Captured as state (not a ref) so the popover container is set before the user opens
  // the combobox — letting it portal inside the dialog's scroll-lock subtree.
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  function reset() {
    setValues(activeEntry ? mapEntryToValues(activeEntry) : EMPTY);
    setErrors({});
    setServerError(null);
    setRefetchNoMatch(false);
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

  /**
   * The single post-save seam: validate, write (POST add / PUT edit), surface errors.
   * Returns `{ ok }` plus, on a successful ADD, the freshly-created `entry` so the caller can
   * reopen it in edit mode.
   */
  async function save(): Promise<{ ok: boolean; created?: LibraryEntry }> {
    setServerError(null);
    if (!validate()) {
      return { ok: false };
    }
    setPending(true);
    try {
      const response = activeEntry
        ? await fetch(`/api/library/${activeEntry.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(mapValuesToBody(values)),
          })
        : await fetch("/api/library", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: values.title.trim(), platform: values.platform.trim() }),
          });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setServerError(data?.error ?? "Something went wrong. Please try again.");
        return { ok: false };
      }
      if (!isEdit) {
        rememberPlatform(values.platform);
        setSavedSinceOpen(true);
        const data = (await response.json().catch(() => null)) as { entry?: LibraryEntry } | null;
        return { ok: true, created: data?.entry };
      }
      return { ok: true };
    } catch {
      setServerError("Network error. Please try again.");
      return { ok: false };
    } finally {
      setPending(false);
    }
  }

  async function handleSave() {
    const result = await save();
    if (!result.ok) {
      return;
    }
    if (isEdit) {
      // Reload the current page (preserve ?page) so the SSR list reflects the edit.
      window.location.reload();
    } else if (result.created) {
      // Reopen the just-created entry in edit mode for review/correction — the dialog stays open
      // and flips to edit (footer swaps "Save & add another" for Delete; metadata fields appear).
      setSavedEntry(result.created);
      setValues(mapEntryToValues(result.created));
      setErrors({});
      setServerError(null);
      setRefetchNoMatch(false);
    } else {
      // Defensive: no entry came back — fall back to S-01's "navigate to the list" behavior.
      window.location.assign("/library");
    }
  }

  async function handleSaveAndAddAnother() {
    if ((await save()).ok) {
      reset();
      titleRef.current?.focus();
    }
  }

  /** Re-fetch IGDB metadata into the form for review — never writes, never destroys typed data. */
  async function handleRefetch() {
    setRefetchNoMatch(false);
    setRefetchPending(true);
    try {
      const response = await fetch("/api/library/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: values.title.trim(), platform: values.platform.trim() }),
      });
      if (!response.ok) {
        setRefetchNoMatch(true);
        return;
      }
      const data = (await response.json().catch(() => null)) as { result?: IgdbLookupResult } | null;
      const result = data?.result;
      if (result?.status === "matched") {
        patchValues({
          genre: result.genre,
          developer: result.developer,
          series: result.series,
          release_year: result.releaseYear,
          release_date: result.releaseDate,
          length_hours: result.lengthHours,
          igdb_id: result.igdbId,
          metadata_status: "matched",
        });
      } else {
        setRefetchNoMatch(true);
      }
    } catch {
      setRefetchNoMatch(true);
    } finally {
      setRefetchPending(false);
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
        {isEdit ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Edit"
            title="Edit"
            className="size-8 text-blue-100/70 hover:bg-white/10 hover:text-white"
          >
            <Pencil />
          </Button>
        ) : (
          <Button size={triggerSize}>
            <Plus />
            {triggerLabel}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent ref={setContentEl} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit game" : "Add a game"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update any field. Re-fetch metadata to pull fresh IGDB data for review."
              : "Enter a title and platform — we’ll fetch its metadata automatically."}
          </DialogDescription>
          {isEdit && values.metadata_status !== "matched" && (
            <span className="w-fit rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200">No metadata</span>
          )}
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
            mode={isEdit ? "edit" : "add"}
            onRefetch={() => void handleRefetch()}
            refetchPending={refetchPending}
            refetchNoMatch={refetchNoMatch}
          />
          {serverError && <p className="text-destructive text-sm">{serverError}</p>}
          <DialogFooter>
            {activeEntry ? (
              <DeleteEntryDialog
                entry={activeEntry}
                trigger={
                  <Button type="button" variant="destructive" disabled={pending}>
                    Delete
                  </Button>
                }
              />
            ) : (
              <Button type="button" variant="outline" disabled={pending} onClick={() => void handleSaveAndAddAnother()}>
                Save &amp; add another
              </Button>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
