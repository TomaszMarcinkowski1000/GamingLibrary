# opencv.js (WASM) — Box contour detection + 4-point perspective rectification

> Sources (fetched 2026-06-11 via Context7 + official OpenCV 4.x docs):
> - Setup / usage: https://docs.opencv.org/4.x/d0/d84/tutorial_js_usage.html
> - Contours (begin): https://docs.opencv.org/4.x/d5/daa/tutorial_js_contours_begin.html
> - Contour features (approxPolyDP etc.): https://docs.opencv.org/4.x/dc/dcf/tutorial_js_contour_features.html
> - Geometric transforms (perspective): https://docs.opencv.org/4.x/dd/d52/tutorial_js_geometric_transformations.html
> - Data structures (Point/Size/Scalar): https://docs.opencv.org/4.x/df1/tutorial_js_some_data_structures.html
> - npm wrapper option: https://www.npmjs.com/package/@techstark/opencv-js (`/techstark/opencv-js`)

## Scope for this spike

**Client-side** (browser, React 19 island) pre-processing: detect the rectangular game-box
contour in the user's photo and **rectify** it (de-skew / flatten perspective) before the
image is sent to the server-side OpenRouter vision call. This is optional polish for the
spike — it can improve identification accuracy by giving the model a clean, head-on box.

opencv.js is a **WASM build** of OpenCV. It runs in the browser only — **not in the
Cloudflare Worker** (workerd has no DOM `canvas`/`HTMLImageElement` that `cv.imread` expects,
and the build is large). Keep it on the client.

---

## 1. Loading opencv.js

Two practical options:

**A. Plain script (official build).** Load `opencv.js` and wait for the runtime:

```html
<script async src="https://docs.opencv.org/4.x/opencv.js" type="text/javascript"></script>
```

```js
// opencv.js sets a global `cv` that may be a Promise until WASM is ready
imgElement.onload = async function () {
  cv = cv instanceof Promise ? await cv : cv;
  let mat = cv.imread(imgElement);
  cv.imshow("canvasOutput", mat);
  mat.delete();
};
```

**B. npm wrapper for our bundler (recommended for the React island):**
`@techstark/opencv-js` ships browser + types and integrates with Vite/Astro:

```ts
import cv from "@techstark/opencv-js";
// await the runtime before first use:
await new Promise<void>((resolve) => {
  if (cv.Mat) return resolve();
  cv.onRuntimeInitialized = () => resolve();
});
```

> **Memory:** every `cv.Mat` / `cv.MatVector` is manually managed WASM memory — call
> `.delete()` on each when done or you leak. This is the #1 opencv.js footgun.

---

## 2. Pipeline: photo → box contour → 4 corners → rectified image

Standard "document scanner" recipe, applied to a game box:

1. Read image to a `Mat` (`cv.imread`).
2. Grayscale → blur → edges (or threshold) to a single-channel binary image.
3. `cv.findContours` to get candidate outlines.
4. Pick the largest 4-sided contour via `cv.contourArea` + `cv.approxPolyDP`.
5. Order its 4 corners, build src/dst point matrices.
6. `cv.getPerspectiveTransform` → `cv.warpPerspective` to flatten.

### 2a. Pre-process + find contours

```js
let src = cv.imread(canvasInput);
let gray = new cv.Mat();
cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
cv.Canny(gray, gray, 75, 200); // edges; or cv.threshold(...) for high-contrast boxes

let contours = new cv.MatVector();
let hierarchy = new cv.Mat();
// findContours modifies the source — pass the edge/binary image
cv.findContours(gray, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
```

`findContours` needs a **single-channel, 8-bit** image. `RETR_LIST` returns all contours;
`CHAIN_APPROX_SIMPLE` compresses straight segments to endpoints.

### 2b. Pick the largest 4-corner contour

```js
let best = null;
let bestArea = 0;
for (let i = 0; i < contours.size(); i++) {
  const cnt = contours.get(i);
  const area = cv.contourArea(cnt, false);
  if (area > bestArea) {
    const peri = cv.arcLength(cnt, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(cnt, approx, 0.02 * peri, true); // epsilon = 2% of perimeter
    if (approx.rows === 4) {
      best?.delete();
      best = approx;        // keep the 4-corner approximation
      bestArea = area;
    } else {
      approx.delete();
    }
  }
  cnt.delete();
}
// `best` now holds 4 corner points (a cv.Mat of CV_32S, rows=4) — or null if none found
```

Relevant functions (from contour-features docs):

- **`cv.approxPolyDP(curve, approxCurve, epsilon, closed)`** — Douglas-Peucker simplification.
  `epsilon` = max distance between original curve and approximation (use a fraction of
  `arcLength`). A clean rectangle approximates to exactly **4 points**.
- **`cv.arcLength(curve, closed)`** — contour perimeter (feeds epsilon).
- **`cv.contourArea(contour, oriented=false)`** — area, to pick the biggest candidate.
- `cv.boundingRect(points)` — upright bounding box (fallback if no clean quad).
- `cv.minAreaRect(points)` — minimum-area *rotated* rectangle (alternative to approxPolyDP for
  the box outline).

### 2c. Four-point perspective transform

`getPerspectiveTransform(src, dst)` computes the 3×3 matrix from 4 source corners to 4
destination corners (3 of them must not be collinear); `warpPerspective` applies it.

```js
cv.getPerspectiveTransform(src, dst); // -> 3x3 Mat (CV_64FC1)
cv.warpPerspective(src, dst, M, dsize, flags, borderMode, borderValue);
```

Build the point matrices with `cv.matFromArray(rows, cols, cv.CV_32FC2, [...])` — each point
is an (x, y) pair, **ordered consistently** (e.g. TL, TR, BR, BL):

```js
const W = 600, H = 800; // target rectified size (box aspect ~3:4)

// srcPts: the 4 detected corners, ordered TL, TR, BR, BL
let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
  tlx, tly,  trx, try_,  brx, bry,  blx, bly,
]);
let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
  0, 0,   W, 0,   W, H,   0, H,
]);

let M = cv.getPerspectiveTransform(srcTri, dstTri);
let dst = new cv.Mat();
let dsize = new cv.Size(W, H);
cv.warpPerspective(
  src, dst, M, dsize,
  cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar()
);

cv.imshow("canvasOutput", dst); // rectified box; read pixels back out for upload
```

`warpPerspective` params:
- `M` — 3×3 transform (`cv.CV_64FC1`).
- `dsize` — output size (`cv.Size`).
- `flags` — interpolation, e.g. `cv.INTER_LINEAR` / `cv.INTER_NEAREST`.
- `borderMode` — `cv.BORDER_CONSTANT` / `cv.BORDER_REPLICATE`.
- `borderValue` — fill color for constant border (`cv.Scalar`).

> **Corner ordering matters.** Detected corners come in arbitrary order; sort them into a
> stable TL/TR/BR/BL order (e.g. by sum and difference of coordinates) before building
> `srcTri`, or the output will be flipped/rotated.

### 2d. Get the result back for upload

After `cv.imshow("canvasOutput", dst)`, pull the rectified image off the canvas as a Blob/
data URL and hand it to the OpenRouter call (see `openrouter.md`):

```js
const canvas = document.getElementById("canvasOutput");
canvas.toBlob((blob) => {/* upload blob */}, "image/jpeg", 0.9);
```

---

## 3. Cleanup (always)

```js
src.delete(); gray.delete(); dst.delete();
contours.delete(); hierarchy.delete();
best?.delete();
srcTri.delete(); dstTri.delete(); M.delete();
```

---

## 4. Notes for the spike

- **Optional, not required.** If accuracy without rectification already clears ≥90%, skip
  opencv.js entirely — it adds a heavy WASM download and complexity to the client.
- **Graceful fallback:** if no clean 4-corner contour is found, send the **original** photo
  rather than a bad crop.
- **Size budget:** the official `opencv.js` is several MB; load it lazily (only on the photo
  screen) to protect first-load and the latency guardrail.
- **Helper functions:** OpenCV.js has no built-in 4-point ordering helper — port the common
  "order_points" routine (sum/diff of coords) used in Python document-scanner tutorials.
