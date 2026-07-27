import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Risk #3, from the other side of the pointer split — "the end-to-end photo journey breaks …
 * or a desktop step sneaks in." (`context/foundation/test-plan.md` §2 Risk #3; plan
 * `context/changes/testing-e2e-photo-flow/plan.md` Phase 4.)
 *
 * `photo-capture-mobile.spec.ts` is this phase's headline spec and owns the camera affordance.
 * This one is the fine-pointer half, and it earns its own browser for a second, independent
 * reason: it is **the only test at any layer that executes `downscaleImage`**
 * (`src/lib/image/downscale.ts:52-86`). `vitest.config.ts:24-25` sets `environment: "node"` and
 * collects only `src/**\/*.test.ts`, and the repo has no jsdom / happy-dom / testing-library at
 * all — so `createImageBitmap` → canvas → `toBlob` cannot run anywhere else. `downscale.test.ts`
 * covers `computeTargetDimensions`, the pure arithmetic helper; the browser half beneath it has
 * been shipping untested.
 *
 * The fixture is **1600×1200**, deliberately above `DEFAULT_MAX_EDGE = 1024`, so the *scaling*
 * branch runs rather than the pass-through (`downscale.ts:32-34`). Nothing below asserts output
 * dimensions — that would mirror the implementation. The proof that the resize ran is the journey
 * completing at all: a throw anywhere in `downscaleImage` is caught at `PhotoCapture.tsx:91-97`,
 * which surfaces *"Couldn’t read that image."* and never POSTs, so the identify response and the
 * saved row below are downstream of a real, successful browser downscale.
 *
 * ## What a green run here does NOT prove
 *
 *   - **Not mobile Safari, nor any browser-NFR cell.** This runs on the default `chromium`
 *     (Desktop Chrome) project. `prd.md:173` demands latest-two across four browsers × two form
 *     factors; that matrix keeps its manual home
 *     (`context/archive/2026-06-17-photo-to-library/plan.md:230-237`). WebKit is declined in
 *     writing — plan Decision 3.
 *   - **Not EXIF orientation.** `downscaleImage` bakes it in via
 *     `createImageBitmap(file, { imageOrientation: "from-image" })` (`downscale.ts:57`), and this
 *     spec runs that line — but asserting the *result* needs pixel inspection, a different
 *     instrument (`toMatchSnapshot` / a visual-diff tool) and a different risk. Recorded, not
 *     covered.
 *   - **Not output image quality or dimensions.** See above: mirroring `computeTargetDimensions`
 *     here would duplicate `downscale.test.ts:5-40`'s 7 cases at 1000× the cost.
 *   - **Not the provider integration or the 10 s p95 latency NFR** (`prd.md:170`). The seam below
 *     removes the OpenRouter round-trip, so this suite is worthless as latency evidence and never
 *     exercises the real vision provider.
 *
 * ## Deliberate omissions
 *
 *   - **The "Identifying your game…" overlay** (`PhotoCapture.tsx:170-179`). Racy or vacuous with
 *     the provider hop stubbed — same call as the camera spec.
 *   - **Row count.** F3 (`context/archive/2026-06-17-photo-to-library/reviews/impl-review.md`) is
 *     a known, deliberately-deferred duplication seam. Cleanup below is tolerant and asserts no
 *     count.
 *   - **Title, `igdb_id`, `metadata_status`.** §6.2's integration suite owns the identify seam at
 *     37 assertions. Journey *shape* only.
 *
 * ## Falsification log (§6.3's control question, answered by experiment)
 *
 * | Break | Assertion that reddens | Observed |
 * |---|---|---|
 * | Comment out `window.location.assign("/library")` (`PhotoCapture.tsx:259-261`) — *the risk itself* | the final row assertion (`element(s) not found`) | ✅ red (2026-07-27) |
 * | Drop the `[@media(pointer:coarse)]:hidden` class from the desktop button (`PhotoCapture.tsx:199`) — the "a desktop step sneaks in" clause, inverted | `toHaveCount(1)` → `Received: 2` | ✅ red (2026-07-27) |
 * | Hide the desktop button and unhide the dropdown instead — the *same* leak with the count still at 1 | `not.toHaveAttribute("aria-haspopup")` → resolved the Radix trigger | ✅ red (2026-07-27) |
 * | `throw` at the top of `downscaleImage` (`downscale.ts:57`) | `waitForResponse` — no POST is ever made | ✅ red (2026-07-27) |
 * | Drop `entry` from the persist response (`identify.ts:192`) | the `"Edit game"` dialog assertion (`element(s) not found`) | ✅ red (2026-07-27) |
 *
 * The last row carries a contrast rather than a break: under it **all 235 Vitest tests stayed
 * green** (measured 2026-07-27), because the route still answers `{status, igdbId, metadataStatus}`
 * — all `identify.test.ts:157,173` ever look at — while the island degrades to add-mode. The two
 * photo specs are the only things in the repo that notice.
 *
 * The third row is why the `aria-haspopup` assertion is not decorative: the obvious leak is caught
 * by the count alone, but a leak that swaps *which* branch survives keeps the count at 1 and is
 * caught only there. The fourth row is this spec's own reason to exist — with the downscale broken
 * the journey never reaches the network, which is the proof that the browser half really runs here
 * rather than being incidentally along for the ride.
 *
 * Breaks are applied to a scratch tree, observed, and reverted — never committed.
 *
 * Note for the next reader (plan Phase 4, manual item 4.5): **`filechooser` was sufficient** — the
 * documented `page.locator('input[type="file"]')` fallback was *not* needed. Playwright's
 * `filechooser` event does fire for the island's programmatic `ref.current?.click()`
 * (`PhotoCapture.tsx:66`), so this spec stays inside `e2e/RULES.md`'s locator rules end to end.
 *
 * Read `e2e/RULES.md` and `e2e/seed.spec.ts` before changing this file.
 */

/** Absolute path — `setFiles` resolves relative paths against the runner's cwd, not the spec's. */
const JPG_PATH = fileURLToPath(new URL("fixtures/box.jpg", import.meta.url));

/**
 * The spec side of the determinism seam. `playwright.config.ts:22` loads `.env`; the dev server
 * reads its own copy from `.dev.vars`, and the two must match (see `.env.example`).
 */
const STUB_KEY = process.env.E2E_VISION_STUB_KEY ?? "";

/**
 * Click an island's trigger and wait for what it should reveal, retrying the click if nothing
 * appeared. Same helper as `photo-capture-mobile.spec.ts:109` — the full rationale lives there.
 * In short: Astro islands ship interactive-*looking* SSR HTML before React attaches, so a click
 * landing in that window is swallowed with no error. Not a disguised sleep — the retry waits on
 * state, and a genuinely broken affordance still fails the block.
 */
async function clickUntilRevealed(trigger: Locator, revealed: Locator) {
  await expect(async () => {
    await trigger.click();
    await expect(revealed).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/**
 * The same hydration guard, for the one trigger whose effect is not a DOM node: "Add via photo"
 * calls `galleryInputRef.current?.click()` (`PhotoCapture.tsx:63-67`), so what a landed click
 * reveals is a *file chooser*, not an element. Pre-hydration the React `onClick` isn't attached
 * yet and the chooser never opens.
 *
 * `filechooser` is the sanctioned way to reach this input: it carries no label, no id, and no
 * role (`PhotoCapture.tsx:189-195`), so `getByLabel`/`getByRole` cannot see it and the only
 * alternative is `page.locator('input[type="file"]')` — a CSS selector `e2e/RULES.md` rules out.
 * That the input is unreachable by accessible name is a real gap in the app, not a rule bent
 * quietly here.
 */
async function pickFileUntilChooserOpens(page: Page, trigger: Locator, filePath: string) {
  await expect(async () => {
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 1000 });
    await trigger.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(filePath);
  }).toPass({ timeout: 15_000 });
}

test("game chosen from the gallery is downscaled, saved, and visible in the library", async ({ page }) => {
  expect(
    STUB_KEY,
    "E2E_VISION_STUB_KEY missing. Add the same non-empty value to `.env` (spec side) and " +
      "`.dev.vars` (server side), then restart the dev server — see `.env.example`.",
  ).toBeTruthy();

  const title = `E2E Gallery Journey ${String(Date.now())}`;
  // `normalizeTitleCasing` is on the seam's path deliberately, so the title has to be one it
  // leaves alone: mixed case with a numeric suffix round-trips unchanged (`src/lib/platforms.ts`).
  const rows = page.getByRole("row", { name: new RegExp(title) });

  // Arm the seam per-request: intercept the island's *own same-origin* fetch
  // (`PhotoCapture.tsx:137`) and add headers before continuing — not a mocked response. The
  // route's multipart parse, size/mime validation, grounding, insert, and SSR re-render all still
  // run for real. (`e2e/RULES.md`'s server-side caveat is about the Worker→OpenRouter hop, which
  // stays un-interceptable; that hop is exactly what the seam replaces.)
  await page.route("**/api/identify", async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        "x-e2e-vision-key": STUB_KEY,
        "x-e2e-vision-title": title,
      },
    });
  });

  await page.goto("/library");

  // The pointer split, asserted from the desktop side — the "a desktop step sneaks in" clause of
  // Risk #3, inverted into "a *mobile* step must not sneak onto desktop". Both branches are always
  // in the DOM and differentiated only by `display:none` (`PhotoCapture.tsx:197-240`), so a CSS
  // regression that leaked the coarse-pointer branch here resolves a second button and this fails.
  const photoButton = page.getByRole("button", { name: "Add via photo" });
  await expect(photoButton).toHaveCount(1);
  // ...and the one that resolved is the plain button, not the dropdown trigger. `aria-haspopup` is
  // the discriminator because it is the *semantic* difference a screen-reader user hears ("menu"
  // vs. nothing); Radix's `DropdownMenuTrigger` sets it, the bare `Button` does not. The naive
  // check — `getByRole("menuitem", { name: "Take photo" })` at count 0 — would be vacuous: Radix
  // renders menu content only while open, so it is 0 on mobile too until the menu is clicked.
  await expect(photoButton).not.toHaveAttribute("aria-haspopup");

  // State-based wait on the request the selection triggers — never a timeout, and registered
  // *before* the click so a fast round-trip can't be missed.
  const identify = page.waitForResponse("**/api/identify");

  // Choose the oversized fixture. This is where `downscaleImage`'s browser half runs, and it is
  // load-bearing: workerd has no `sharp`, so an un-resized upload is not something the server can
  // rescue (`identify.ts:33-36`).
  await pickFileUntilChooserOpens(page, photoButton, JPG_PATH);

  // No menu opened — the click went straight to the picker. Complements the `aria-haspopup`
  // assertion above with the behavioural face of the same property.
  await expect(page.getByRole("menu")).toHaveCount(0);

  // Asserting the status turns a disarmed seam (502 from the real provider) into a readable
  // failure instead of a downstream dialog timeout. Reaching a 200 at all means the downscale
  // produced a valid JPEG that cleared the route's mime and 10 MB checks.
  const response = await identify;
  expect(response.status(), "POST /api/identify did not succeed — is the seam key set server-side?").toBe(200);

  // "Edit game" rather than "Add a game" is the dialog's only observable face of the route
  // returning the persisted `entry` (`identify.ts:192` → `PhotoCapture.tsx:146` →
  // `GameDialog.tsx:366`). Nothing else in the repo asserts that contract:
  // `identify.test.ts:157,173` check `{status, igdbId, metadataStatus}` only, so dropping `entry`
  // degrades the island to add-mode with every Vitest test still green.
  const reviewDialog = page.getByRole("dialog", { name: "Edit game" });
  await expect(reviewDialog).toBeVisible();
  await reviewDialog.getByRole("button", { name: "Close" }).click();

  // The assertion that carries the risk. Closing the dialog is when `PhotoCapture.tsx:259-261`
  // re-navigates to `/library`, because the SSR list cannot know about the row just saved beneath
  // it (`src/pages/library/index.astro:223-265`, and nothing client-side re-fetches it).
  // `waitForURL` would be a no-op — the target is the URL we are already on — so the navigation is
  // awaited through the row itself: it is absent from the currently-rendered list, and only a
  // fresh SSR render as this user can produce it.
  await expect(rows.first()).toBeVisible();

  // Cleanup: remove every row this test created and assert the removal took. The loop (rather than
  // seed.spec.ts's single delete) is the F3 tolerance — if the abort seam ever duplicates, this
  // still leaves the library clean instead of failing on a count nobody owns here.
  for (let remaining = await rows.count(); remaining > 0; remaining = await rows.count()) {
    const confirm = page.getByRole("alertdialog");
    await clickUntilRevealed(rows.first().getByRole("button", { name: "Delete" }), confirm);
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(rows).toHaveCount(remaining - 1);
  }
});
