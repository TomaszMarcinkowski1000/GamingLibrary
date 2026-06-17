/**
 * Client-side image downscale for the photo-capture flow (S-03).
 *
 * workerd has no Node `sharp`, so the identify route can't resize server-side — the browser
 * must shrink the user's photo before upload. Downscaling to a bounded long edge keeps the mobile
 * uplink small (the unmodeled leg of the 10 s p95 latency NFR), bounds the base64 vision payload,
 * and clears the route's 10 MB cap with headroom — while matching the ~1024 px resolution F-03
 * measured its accuracy at.
 */

/** Tuning knobs. `maxEdge` bounds the longer side; `quality` is the JPEG encoder quality (0–1). */
export interface DownscaleOptions {
  maxEdge?: number;
  quality?: number;
}

export const DEFAULT_MAX_EDGE = 1024;
export const DEFAULT_QUALITY = 0.85;

/**
 * Pure dimension math: scale `(width, height)` so the longer edge is at most `maxEdge`, preserving
 * aspect ratio. An image already within the bound passes through unscaled (`scale === 1`). Output
 * dimensions are rounded to whole pixels. Extracted from {@link downscaleImage} so the resize
 * arithmetic is unit-testable without a canvas/DOM.
 */
export function computeTargetDimensions(
  width: number,
  height: number,
  maxEdge: number = DEFAULT_MAX_EDGE,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) {
    return { width, height };
  }
  const scale = maxEdge / longEdge;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * Resize a user-selected image to a bounded long edge and re-encode as JPEG.
 *
 * EXIF orientation is baked in via `createImageBitmap(file, { imageOrientation: "from-image" })` —
 * phone photos carry an orientation tag and a naive canvas draw would rotate the box sideways and
 * tank the vision read. The bitmap is drawn onto a sized canvas and exported as a JPEG `Blob`.
 *
 * Runs in the browser only (needs `createImageBitmap` + canvas); the dimension arithmetic it relies
 * on lives in {@link computeTargetDimensions}, which is what the unit tests exercise.
 */
export async function downscaleImage(file: File, opts: DownscaleOptions = {}): Promise<Blob> {
  const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = opts.quality ?? DEFAULT_QUALITY;

  // `from-image` makes the decoder apply the EXIF orientation so the pixels we draw are upright.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { width, height } = computeTargetDimensions(bitmap.width, bitmap.height, maxEdge);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not get a 2D canvas context for image downscaling");
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Canvas failed to encode the image"));
          }
        },
        "image/jpeg",
        quality,
      );
    });
  } finally {
    bitmap.close();
  }
}
