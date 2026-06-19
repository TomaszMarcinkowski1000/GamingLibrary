import { useRef, useState } from "react";
import { Camera, ChevronDown, Image as ImageIcon, Loader2 } from "lucide-react";
import type { LibraryEntry, MetadataStatus } from "@/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downscaleImage } from "@/lib/image/downscale";
import GameDialog from "./GameDialog";
import CameraCapture from "./CameraCapture";

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
 * Two capture paths, split by pointer type (pure CSS):
 *   - fine pointer (desktop) → a single "Add via photo" button → a hidden gallery file input;
 *   - coarse pointer (mobile) → a dropdown offering "Take photo" (in-page live camera) and
 *     "Choose from gallery" (the same hidden file input).
 *
 * The gallery path (plain `<input type="file" accept="image/*">`, no `capture`) is 100% reliable on
 * desktop and mobile and is unchanged. "Take photo" opens {@link CameraCapture}, an in-page
 * `getUserMedia` live preview, rather than `<input capture>`: the OS camera app backgrounds/evicts
 * this page and drops the in-flight identify connection ~80% of the time (manual-test evidence).
 * This deliberately revisits the plan's "No getUserMedia live-preview capture" non-goal, now
 * obsolete given that failure rate. Ref: MDN "Taking still photos with getUserMedia".
 *
 * Both paths converge on {@link submitBlob}: POST to `/api/identify` with `persist` (workerd can't
 * resize, so images are downscaled client-side first), then branch:
 *   - `identified` → open {@link GameDialog} (controlled) seeded with the persisted `entry` for review;
 *   - `unsure`     → show a "couldn't identify" note and open the dialog in empty manual-add mode;
 *   - HTTP error   → render an inline message and offer manual add.
 */
export default function PhotoCapture({ platformOptions }: PhotoCaptureProps) {
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  // The persisted row to review (identified path) or `undefined` (unsure → empty add mode).
  const [reviewEntry, setReviewEntry] = useState<LibraryEntry | undefined>(undefined);
  // Bumped per result so GameDialog remounts and re-seeds its form state from the new entry/EMPTY.
  const [dialogKey, setDialogKey] = useState(0);

  function pick(ref: React.RefObject<HTMLInputElement | null>) {
    setError(null);
    setNotice(null);
    ref.current?.click();
  }

  function openDialog(entry: LibraryEntry | undefined) {
    setReviewEntry(entry);
    setDialogKey((key) => key + 1);
    setDialogOpen(true);
  }

  /** Gallery path: a selected file is downscaled (EXIF orientation baked in) then submitted. */
  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input so re-selecting the same file fires `change` again.
    event.target.value = "";
    if (!file) {
      return;
    }

    setError(null);
    setNotice(null);
    // Raise the blocking overlay before the decode so it covers the whole gallery operation
    // (downscale + identify), not just the fetch — on slower mobile decoders the bare-decode gap
    // otherwise reads as "nothing happened". `submitBlob` keeps it raised through the request.
    setPending(true);
    let blob: Blob;
    try {
      blob = await downscaleImage(file);
    } catch {
      setPending(false);
      setError("Couldn’t read that image. Please try a different photo.");
      return;
    }
    await submitBlob(blob);
  }

  /** Camera path: the captured frame is already a downscaled, upright JPEG — submit it directly. */
  function handleCameraCapture(blob: Blob) {
    setCameraOpen(false);
    void submitBlob(blob);
  }

  function handleCameraError(message: string) {
    setCameraOpen(false);
    setError(message);
  }

  /**
   * The shared identify→persist→review pipeline for both capture paths. POSTs the JPEG to
   * `/api/identify` with `persist`, shows the blocking overlay, and routes the response.
   */
  async function submitBlob(blob: Blob) {
    setError(null);
    setNotice(null);
    setPending(true);
    // Bound the wait. A slow network or an interrupted upload can leave the request hanging — the
    // server may still process and persist the row, but the response never arrives, so without a
    // ceiling the spinner would hang forever. On abort we point the user at a refresh.
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 30000);
    try {
      const form = new FormData();
      form.append("photo", blob, "photo.jpg");
      form.append("persist", "true");

      const response = await fetch("/api/identify", { method: "POST", body: form, signal: controller.signal });
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
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("That’s taking longer than expected. Refresh the page — your game may already be saved.");
      } else {
        setError("Couldn’t reach the server. Please check your connection and try again.");
      }
    } finally {
      clearTimeout(timeout);
      setPending(false);
    }
  }

  const buttonLabel = pending ? "Identifying…" : "Add via photo";

  return (
    <div className="flex flex-col items-end gap-1">
      {/* Full-screen blocking overlay while the read is in flight: communicates progress and stops
          interaction with the page (no double-submits, no stray navigation) on desktop and mobile. */}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/70 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-12 animate-spin text-white" />
          <p className="text-base font-medium text-white">Identifying your game…</p>
        </div>
      )}
      {cameraOpen && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onCancel={() => {
            setCameraOpen(false);
          }}
          onError={handleCameraError}
        />
      )}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleFile(e)}
      />

      {/* Desktop (fine pointer): one button → the gallery/file picker. */}
      <Button
        className="[@media(pointer:coarse)]:hidden"
        onClick={() => {
          pick(galleryInputRef);
        }}
        disabled={pending}
      >
        <Camera />
        {buttonLabel}
      </Button>

      {/* Mobile (coarse pointer): a dropdown splitting camera vs. gallery. */}
      <div className="hidden [@media(pointer:coarse)]:block">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button disabled={pending}>
              <Camera />
              {buttonLabel}
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setError(null);
                setNotice(null);
                setCameraOpen(true);
              }}
            >
              <Camera />
              Take photo
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                pick(galleryInputRef);
              }}
            >
              <ImageIcon />
              Choose from gallery
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* The unsure note is surfaced *inside* GameDialog (see `notice` prop) rather than here, so it
          stays visible on mobile where the dialog covers this area. Only the error (no dialog opens on
          error) renders inline below the button. */}
      {error && <p className="text-destructive max-w-xs text-right text-sm">{error}</p>}

      <GameDialog
        key={dialogKey}
        platformOptions={platformOptions}
        entry={reviewEntry}
        notice={notice}
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
