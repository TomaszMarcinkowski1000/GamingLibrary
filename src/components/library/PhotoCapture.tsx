import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import type { LibraryEntry, MetadataStatus } from "@/types";
import { Button } from "@/components/ui/button";
import { downscaleImage } from "@/lib/image/downscale";
import GameDialog from "./GameDialog";

/**
 * The `/api/identify` persist-path response (mirrors the route's `IdentifyResponse`, which is
 * route-local). `identified` carries the persisted `entry`; `unsure` is the abstain that routes to
 * manual add. Error responses carry `{ error }` with a non-2xx status.
 */
type IdentifyResponse =
  | {
      status: "identified";
      title: string;
      platform: string;
      confidence: number;
      igdbId: number | null;
      metadataStatus: MetadataStatus | null;
      entry?: LibraryEntry;
    }
  | { status: "unsure"; confidence: number };

interface PhotoCaptureProps {
  /** Platform vocabulary passed through to the review/manual-add dialog. */
  platformOptions: string[];
}

const UNSURE_NOTICE = "We couldn’t identify that photo — add the game manually instead.";

/**
 * "Add via photo" entry point and orchestrator of the identify→review flow (S-03, north star).
 *
 * A hidden `<input type="file" accept="image/*">` (no `capture` attribute, so mobile offers
 * Camera / Photo Library / Files and desktop shows a file picker — both FR-004 paths). On
 * selection: downscale client-side (workerd can't resize), POST to `/api/identify` with `persist`,
 * then branch:
 *   - `identified` → open {@link GameDialog} (controlled) seeded with the persisted `entry` for review;
 *   - `unsure`     → show a "couldn't identify" note and open the dialog in empty manual-add mode;
 *   - HTTP error   → render an inline message and offer manual add.
 */
export default function PhotoCapture({ platformOptions }: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // The persisted row to review (identified path) or `undefined` (unsure → empty add mode).
  const [reviewEntry, setReviewEntry] = useState<LibraryEntry | undefined>(undefined);
  // Bumped per result so GameDialog remounts and re-seeds its form state from the new entry/EMPTY.
  const [dialogKey, setDialogKey] = useState(0);

  function pickPhoto() {
    setError(null);
    setNotice(null);
    inputRef.current?.click();
  }

  function openDialog(entry: LibraryEntry | undefined) {
    setReviewEntry(entry);
    setDialogKey((key) => key + 1);
    setDialogOpen(true);
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input so re-selecting the same file fires `change` again.
    event.target.value = "";
    if (!file) {
      return;
    }

    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const blob = await downscaleImage(file);
      const form = new FormData();
      form.append("photo", blob, "photo.jpg");
      form.append("persist", "true");

      const response = await fetch("/api/identify", { method: "POST", body: form });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Something went wrong identifying that photo. Please try again.");
        return;
      }

      const data: IdentifyResponse = await response.json();
      if (data.status === "identified") {
        openDialog(data.entry);
      } else {
        setNotice(UNSURE_NOTICE);
        openDialog(undefined);
      }
    } catch {
      setError("Couldn’t read that image. Please try a different photo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handleFile(e)} />
      <Button onClick={pickPhoto} disabled={pending}>
        <Camera />
        {pending ? "Identifying…" : "Add via photo"}
      </Button>
      {error && <p className="text-destructive max-w-xs text-right text-sm">{error}</p>}
      {notice && <p className="max-w-xs text-right text-sm text-amber-200">{notice}</p>}

      <GameDialog
        key={dialogKey}
        platformOptions={platformOptions}
        entry={reviewEntry}
        open={dialogOpen}
        hideTrigger
        onOpenChange={(next) => {
          setDialogOpen(next);
          // A photo-identified entry is persisted server-side before the dialog opens, so a plain
          // close (no edit) still added a row — refresh the list to show it. The unsure → manual-add
          // path persists nothing here; GameDialog's own savedSinceOpen seam refreshes if a game is added.
          if (!next && reviewEntry) {
            window.location.assign("/library");
          }
        }}
      />
    </div>
  );
}
