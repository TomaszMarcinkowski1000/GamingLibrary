import { fileURLToPath } from "node:url";
import { devices, expect, test, type Locator } from "@playwright/test";

/**
 * Risk #3 — "the end-to-end photo journey breaks on a mobile browser: camera capture → identify →
 * auto-saved entry never lands visibly, or a desktop step sneaks in."
 * (`context/foundation/test-plan.md` §2 Risk #3; plan `context/changes/testing-e2e-photo-flow/`.)
 *
 * Why this earns a browser, and the most expensive spec in the repo: the risk reduces to one
 * statement no layer below the browser can observe. The library table is 100% SSR
 * (`src/pages/library/index.astro:223-265`) and nothing client-side re-fetches it, so a
 * photo-identified row is only ever seen because `PhotoCapture.tsx:259-261` re-navigates to
 * `/library` when the review dialog closes. Delete that line and the row is saved, correct, and
 * invisible — Risk #3's "never lands visibly" failure verbatim, with every unit, route-contract,
 * and pgTAP test still green.
 *
 * ## What a green run here does NOT prove
 *
 * Stated because the gap is real and easy to over-claim:
 *
 *   - **Not mobile Safari.** `devices["Pixel 5"]` is Chromium with a mobile UA, viewport, and
 *     `pointer: coarse`. WebKit is declined in writing (plan, Decision 3): the fake-media launch
 *     args below are Chromium-only, so a WebKit run of this spec would silently exercise the
 *     file-input path instead. The four-browser NFR (`prd.md:173`) keeps its manual-matrix home.
 *   - **Not a real camera, and not OS-level page eviction.** The ~80% failure that forced the
 *     `<input capture>` → `getUserMedia` rewrite was the OS camera app backgrounding and evicting
 *     this page, dropping the in-flight identify request
 *     (`PhotoCapture.tsx:36-37`, `context/archive/2026-06-17-photo-to-library/plan.md:47`).
 *     **No emulator reproduces OS app-switching.** If `<input capture>` were reintroduced
 *     tomorrow, this spec would stay green. That is this phase's sharpest honesty constraint.
 *   - **Not the 10 s p95 latency NFR** (`prd.md:170`). The seam below removes the provider
 *     round-trip entirely, so these timings are meaningless as latency evidence.
 *   - **Not the provider integration.** Under the seam this journey never calls OpenRouter; that
 *     moves to manual / pre-prod smoke.
 *
 * ## Deliberate omissions
 *
 *   - **The "Identifying your game…" overlay** (`PhotoCapture.tsx:170-179`). With the provider hop
 *     stubbed it may flash past faster than a locator can catch — an assertion that is either racy
 *     or vacuous. Not asserted.
 *   - **Row count.** F3 (`context/archive/2026-06-17-photo-to-library/reviews/impl-review.md`) is a
 *     known, deliberately-deferred duplication seam on the 30 s abort. Cleanup below is tolerant
 *     and asserts no count, rather than converting someone else's deferred risk into intermittent
 *     red here.
 *   - **Title, `igdb_id`, `metadata_status`.** §6.2's integration suite owns the identify seam at
 *     37 assertions. This spec asserts journey *shape* only.
 *
 * ## Falsification log (§6.3's control question, answered by experiment)
 *
 * | Break | Assertion that reddens | Observed |
 * |---|---|---|
 * | Comment out `window.location.assign("/library")` (`PhotoCapture.tsx:259-261`) — *the risk itself* | the final row assertion | ✅ red (2026-07-27) |
 * | Drop `entry` from the persist response (`identify.ts:192`) | the `"Edit game"` dialog assertion (`element(s) not found`) | ✅ red (2026-07-27) |
 * | Remove `--use-fake-ui-for-media-stream` | the enabled-Capture assertion | ✅ red (Phase 2 probe) |
 *
 * The second row is the one worth reading twice: under that break **all 235 Vitest tests stayed
 * green** (measured 2026-07-27). The route keeps answering `{status, igdbId, metadataStatus}`, which
 * is all `identify.test.ts:157,173` ever look at, while the island silently degrades to add-mode.
 * This spec is the only thing in the repo that notices.
 *
 * Breaks are applied to a scratch tree, observed, and reverted — never committed.
 *
 * Note for the next reader (plan Open Question 6): `.click()` is correct under `hasTouch` and
 * `.tap()` was **not** needed — Playwright synthesizes a `button === 0` pointerdown, which is what
 * Radix's `DropdownMenuTrigger` listens for. The dropdown's real hazard turned out to be a
 * different one: island hydration, handled by {@link clickUntilRevealed} below.
 *
 * Read `e2e/RULES.md` and `e2e/seed.spec.ts` before changing this file.
 */

/** Absolute path is required — Chromium resolves the flag against its own cwd, not the spec's. */
const Y4M_PATH = fileURLToPath(new URL("fixtures/box.y4m", import.meta.url));

/**
 * The spec side of the determinism seam. `playwright.config.ts:22` loads `.env`; the dev server
 * reads its own copy from `.dev.vars`, and the two must match (see `.env.example`).
 */
const STUB_KEY = process.env.E2E_VISION_STUB_KEY ?? "";

test.use({
  // `devices["Pixel 5"]` is what flips `pointer: coarse`, which is what makes the camera
  // affordance reachable at all — on a fine pointer the dropdown is `display:none`
  // (`PhotoCapture.tsx:197-240`). Per-file rather than a second Playwright project, so the rest of
  // the suite doesn't pay for a second full run (`playwright.config.ts:59-61`).
  ...devices["Pixel 5"],
  launchOptions: {
    // All three are load-bearing, and two of them fail *silently*: without the fake device Chromium
    // raises `NotFoundError`, without the fake UI it raises `NotSupportedError` even after
    // `grantPermissions(["camera"])` — and either way `CameraCapture` routes to `onError` and the
    // app falls back to the gallery picker. The spec would then pass green while exercising the
    // exact path it was written to avoid. The enabled-Capture assertion below is the permanent
    // guard against that; these args are what let it pass.
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${Y4M_PATH}`,
    ],
  },
});

/**
 * Click an island's trigger and wait for what it should reveal, retrying the click if nothing
 * appeared.
 *
 * Not a disguised sleep — the retry waits on state, and a genuinely broken affordance still fails
 * the block. It exists because Astro islands ship interactive-*looking* SSR HTML before React
 * attaches: `PhotoCapture` is `client:load` and `EntryRowActions` is `client:visible`
 * (`src/pages/library/index.astro:188,261`), so a click landing in that window is swallowed with no
 * error and no visible effect. `seed.spec.ts` never hits it because every trigger it touches has
 * had seconds of unrelated round-trips to hydrate; this spec reaches its triggers immediately after
 * a page load, and lost the race twice while being written — once on the dropdown, once on the
 * row's Delete. Worth knowing it is also a real (if narrow) UX property, not a test artifact.
 */
async function clickUntilRevealed(trigger: Locator, revealed: Locator) {
  await expect(async () => {
    await trigger.click();
    await expect(revealed).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

test("photographed game is saved and visible in the library on a mobile browser", async ({ page }) => {
  expect(
    STUB_KEY,
    "E2E_VISION_STUB_KEY missing. Add the same non-empty value to `.env` (spec side) and " +
      "`.dev.vars` (server side), then restart the dev server — see `.env.example`.",
  ).toBeTruthy();

  const title = `E2E Camera Journey ${String(Date.now())}`;
  // `normalizeTitleCasing` is on the seam's path deliberately, so the title has to be one it leaves
  // alone: mixed case with a numeric suffix round-trips unchanged (`src/lib/platforms.ts:150-169`).
  const rows = page.getByRole("row", { name: new RegExp(title) });

  // Arm the seam per-request. This intercepts the *island's own same-origin* fetch
  // (`PhotoCapture.tsx:137`) and adds headers before continuing — it does not mock a response, so
  // the route's multipart parse, size/mime validation, grounding, insert, and SSR re-render all
  // still run for real. (`e2e/RULES.md`'s server-side caveat is about the Worker→OpenRouter hop,
  // which stays un-interceptable; that hop is exactly what the seam replaces.)
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

  // The pointer split, asserted from the mobile side: exactly one "Add via photo" resolves (the
  // dropdown trigger — the desktop branch is `display:none` and so out of the accessibility tree),
  // and it offers a camera step.
  const photoButton = page.getByRole("button", { name: "Add via photo" });
  const takePhoto = page.getByRole("menuitem", { name: "Take photo" });
  await expect(photoButton).toHaveCount(1);
  await clickUntilRevealed(photoButton, takePhoto);
  await takePhoto.click();

  // The boundary between a real `getUserMedia` stream and the silent file-input fallback:
  // `CameraCapture`'s Capture button is `disabled={!ready}` and `ready` flips only after
  // `getUserMedia` resolves (`CameraCapture.tsx:80,166`), so "visible dialog with an enabled
  // Capture" *is* "getUserMedia succeeded".
  const camera = page.getByRole("dialog", { name: "Take a photo of the game box" });
  const capture = camera.getByRole("button", { name: "Capture" });
  await expect(camera).toBeVisible();
  await expect(capture).toBeEnabled();

  // State-based wait on the request the capture triggers — never a timeout. Asserting the status
  // here turns a disarmed seam (502 from the real provider) into a readable failure instead of a
  // downstream dialog timeout.
  const identify = page.waitForResponse("**/api/identify");
  await capture.click();
  const response = await identify;
  expect(response.status(), "POST /api/identify did not succeed — is the seam key set server-side?").toBe(200);

  // "Edit game" rather than "Add a game" is the dialog's only observable face of the route
  // returning the persisted `entry` (`identify.ts:192` → `PhotoCapture.tsx:146` →
  // `GameDialog.tsx:366`). Nothing else in the repo asserts that contract: `identify.test.ts:157,173`
  // check `{status, igdbId, metadataStatus}` only, so dropping `entry` degrades the island to
  // add-mode with every Vitest test still green.
  const reviewDialog = page.getByRole("dialog", { name: "Edit game" });
  await expect(reviewDialog).toBeVisible();
  await reviewDialog.getByRole("button", { name: "Close" }).click();

  // The assertion that carries the risk. Closing the dialog is when `PhotoCapture.tsx:259-261`
  // re-navigates to `/library`, because the SSR list cannot know about the row just saved beneath
  // it. `waitForURL` would be a no-op here — the target is the URL we are already on — so the
  // navigation is awaited through the row itself: it is absent from the currently-rendered list and
  // only a fresh SSR render as this user can produce it.
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
