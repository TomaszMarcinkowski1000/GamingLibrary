import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { computeTargetDimensions, DEFAULT_MAX_EDGE, DEFAULT_QUALITY } from "@/lib/image/downscale";

interface CameraCaptureProps {
  /** Receives the captured frame as a downscaled, upright JPEG `Blob` ready for the identify pipeline. */
  onCapture: (blob: Blob) => void;
  /** User dismissed the camera without taking a shot. */
  onCancel: () => void;
  /**
   * The camera couldn't be used (insecure origin, permission denied, no device, capture failure).
   * Carries a user-readable message so the caller can surface it and fall back to the gallery path.
   */
  onError: (message: string) => void;
}

/**
 * In-page live-preview camera (S-03) replacing the OS-camera file input.
 *
 * `<input capture="environment">` hands off to the OS camera app on mobile, which backgrounds/evicts
 * this page; on return the in-flight `/api/identify` connection is dropped ~80% of the time → silent
 * failure. Instead we stream the rear camera with `getUserMedia` into a `<video>` that never leaves
 * the page, draw the chosen frame to a canvas, and export a JPEG — the fetch is never interrupted.
 *
 * `getUserMedia` is `undefined` on insecure origins and rejects on denied/absent cameras; every such
 * case routes to {@link onError} so the caller can fall back to the gallery picker. The MediaStream
 * tracks are stopped on capture, on cancel, and on unmount (so the camera light goes off).
 *
 * Canvas frames are already upright, so the EXIF-orientation step the gallery path needs is moot
 * here — but we still bound the long edge to {@link DEFAULT_MAX_EDGE} to match the upload budget.
 */
export default function CameraCapture({ onCapture, onCancel, onError }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);

  // Keep the latest `onError` reachable from the mount-once effect without listing it as a dep —
  // doing so would tear down and reopen the camera on every parent re-render.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
  }

  // Start the stream once on mount; stop it on unmount. The component is only rendered while the
  // camera is open, so mount/unmount is the lifecycle. Only refs and stable setters are referenced,
  // so the empty dep array is honest (no `eslint-disable`, which would also disable React Compiler).
  useEffect(() => {
    let cancelled = false;

    // `navigator.mediaDevices` is genuinely `undefined` on insecure origins (non-HTTPS, non-localhost),
    // even though the DOM lib types it as always-present — hence the explicit nullable cast.
    const media = navigator.mediaDevices as MediaDevices | undefined;
    const getUserMedia = media?.getUserMedia.bind(media);
    if (!getUserMedia) {
      onErrorRef.current("Your browser can’t open the camera here. Choose a photo from your gallery instead.");
      return;
    }

    getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          // Unmounted before the permission resolved — don't leak the just-opened stream.
          stream.getTracks().forEach((track) => {
            track.stop();
          });
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        const name = err instanceof DOMException ? err.name : "";
        const message =
          name === "NotAllowedError"
            ? "Camera access was blocked. Allow it in your browser settings, or choose from your gallery instead."
            : name === "NotFoundError"
              ? "No camera was found on this device. Choose a photo from your gallery instead."
              : "Couldn’t start the camera. Choose a photo from your gallery instead.";
        onErrorRef.current(message);
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    };
  }, []);

  function handleCapture() {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const { width, height } = computeTargetDimensions(video.videoWidth, video.videoHeight, DEFAULT_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      stopStream();
      onError("Couldn’t capture the frame. Choose a photo from your gallery instead.");
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        // Stop the camera immediately on capture — the page keeps the JPEG, the device light goes off.
        stopStream();
        if (blob) {
          onCapture(blob);
        } else {
          onError("Couldn’t capture that photo. Please try again, or choose from your gallery.");
        }
      },
      "image/jpeg",
      DEFAULT_QUALITY,
    );
  }

  function handleCancel() {
    stopStream();
    onCancel();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Take a photo of the game box"
    >
      <div className="relative flex w-full max-w-2xl flex-1 items-center justify-center">
        <video ref={videoRef} autoPlay muted playsInline className="max-h-full max-w-full rounded-xl object-contain" />
        {!ready && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="size-10 animate-spin" />
            <p className="text-sm">Starting camera…</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" onClick={handleCancel}>
          <X />
          Cancel
        </Button>
        <Button type="button" onClick={handleCapture} disabled={!ready}>
          <Camera />
          Capture
        </Button>
      </div>
    </div>
  );
}
