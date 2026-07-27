/*
 * E2E fixture generator — writes the two binaries `e2e/` needs into `e2e/fixtures/`.
 *
 * They are authored from committed code rather than dropped in as opaque blobs, so a future
 * reader can see exactly what they contain and regenerate them byte-for-byte. Both are
 * committed; this script only has to run when one of them needs to change.
 *
 *   box.y4m — the fake camera's video feed, fed to Chromium via
 *             `--use-file-for-fake-video-capture`. Single 320x240 solid-red frame.
 *   box.jpg — the gallery path's input file, 1600x1200 so it lands *above*
 *             `DEFAULT_MAX_EDGE` (1024) and forces the real client-side downscale.
 *
 * The determinism seam (`E2E_VISION_STUB_KEY`, see `src/lib/services/vision.ts`) means no model
 * ever looks at these pixels, so legibility is irrelevant — size, geometry, and reproducibility
 * are the only properties that matter.
 *
 * Usage: `node scripts/make-e2e-fixtures.mjs`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const FIXTURES_DIR = fileURLToPath(new URL("../e2e/fixtures/", import.meta.url));
const Y4M_PATH = path.join(FIXTURES_DIR, "box.y4m");
const JPG_PATH = path.join(FIXTURES_DIR, "box.jpg");

// --- box.y4m -----------------------------------------------------------------------------------
// Y4M is a plain-text header, then `FRAME\n`, then raw planar bytes — no encoder needed, which is
// why this fixture costs nothing to author (research §Q5: depending on Playwright's bundled ffmpeg
// is fragile). Chromium reproduces the encoded colour exactly and the resulting JPEG is
// byte-identical across runs (research §Q3, measured).
//
// Note the stream resolution is the *Y4M's*, not whatever `getUserMedia` requests — 320x240 is the
// exact geometry research measured working. It sits below DEFAULT_MAX_EDGE on purpose: the camera
// path's downscale is not what the camera spec is testing (the gallery fixture covers resizing).

const Y4M_WIDTH = 320;
const Y4M_HEIGHT = 240;

// BT.601 limited-range YUV for pure red — Chromium decodes this back to ~(254, 0, 0).
const Y4M_LUMA = 81;
const Y4M_CHROMA_U = 90;
const Y4M_CHROMA_V = 240;

function buildY4m() {
  // C420: full-resolution luma, quarter-resolution chroma planes.
  const lumaBytes = Y4M_WIDTH * Y4M_HEIGHT;
  const chromaBytes = (Y4M_WIDTH / 2) * (Y4M_HEIGHT / 2);

  return Buffer.concat([
    Buffer.from(`YUV4MPEG2 W${Y4M_WIDTH} H${Y4M_HEIGHT} F25:1 Ip A1:1 C420\n`, "ascii"),
    Buffer.from("FRAME\n", "ascii"),
    Buffer.alloc(lumaBytes, Y4M_LUMA),
    Buffer.alloc(chromaBytes, Y4M_CHROMA_U),
    Buffer.alloc(chromaBytes, Y4M_CHROMA_V),
  ]);
}

// --- box.jpg -----------------------------------------------------------------------------------
// 1600x1200 is load-bearing: `computeTargetDimensions` returns its input unchanged when the long
// edge is <= DEFAULT_MAX_EDGE (`src/lib/image/downscale.ts:32-34`, 1024), so a smaller fixture
// would quietly exercise the pass-through branch and never the resize the gallery spec exists to
// cover. A flat two-tone image compresses to a couple of KB at that size.

const JPG_WIDTH = 1600;
const JPG_HEIGHT = 1200;
const JPG_QUALITY = 80;

// A dark rectangle on a light field — a stand-in "game box", so a human who opens the file can see
// what it is meant to be. The shape is decorative; only the outer dimensions matter.
const BOX_WIDTH = 800;
const BOX_HEIGHT = 1000;

async function buildJpeg() {
  const inner = await sharp({
    create: { width: BOX_WIDTH, height: BOX_HEIGHT, channels: 3, background: { r: 32, g: 40, b: 72 } },
  })
    .png()
    .toBuffer();

  return sharp({
    create: { width: JPG_WIDTH, height: JPG_HEIGHT, channels: 3, background: { r: 222, g: 226, b: 232 } },
  })
    .composite([
      {
        input: inner,
        left: Math.round((JPG_WIDTH - BOX_WIDTH) / 2),
        top: Math.round((JPG_HEIGHT - BOX_HEIGHT) / 2),
      },
    ])
    .jpeg({ quality: JPG_QUALITY })
    .toBuffer();
}

// --- main --------------------------------------------------------------------------------------

async function main() {
  await mkdir(FIXTURES_DIR, { recursive: true });

  const y4m = buildY4m();
  await writeFile(Y4M_PATH, y4m);
  console.log(`box.y4m  ${Y4M_WIDTH}x${Y4M_HEIGHT} single frame, ${y4m.byteLength} bytes`);

  const jpeg = await buildJpeg();
  await writeFile(JPG_PATH, jpeg);

  // Read the written file back rather than trusting the request: the ">1024 px long edge" property
  // is the one thing about this fixture that can silently break the gallery spec's purpose.
  const { width, height } = await sharp(JPG_PATH).metadata();
  const longEdge = Math.max(width, height);
  console.log(`box.jpg  ${width}x${height}, ${jpeg.byteLength} bytes, long edge ${longEdge}`);

  if (longEdge <= 1024) {
    console.error(`box.jpg long edge is ${longEdge}, which is <= DEFAULT_MAX_EDGE (1024) — it would skip the resize.`);
    process.exitCode = 1;
    return;
  }
  console.log("Fixtures written to e2e/fixtures/.");
}

await main();
