# Rollout Phase 4 — End-to-end photo flow (Risk #3) Implementation Plan

## Overview

Ship the browser-level coverage `context/foundation/test-plan.md` §3 Phase 4 owes for **Risk #3**:
*"the end-to-end photo journey breaks on a mobile browser — camera capture → identify → auto-saved
entry never lands visibly, or a desktop step sneaks in."*

Two Playwright specs, one production seam, and a written ruling on three things the phase cannot
leave implicit: how the identify path is made deterministic, what the browser NFR is *not* covered
by, and what stays out of scope.

The risk reduces to one line of production code. `PhotoCapture.tsx:259-261` calls
`window.location.assign("/library")` when the review dialog closes; the library table is 100% SSR
(`index.astro:54-70`) and nothing client-side re-fetches it (`entrySync.ts:5-14` is a row-scoped
`play_status` pub/sub between two islands of an *already-rendered* row, not a list refresher).
Delete that navigation and a photo-identified row is saved, correct, and **invisible** — Risk #3's
"never lands visibly" failure, verbatim, in one statement no layer below the browser can observe.

## Current State Analysis

**The harness exists; the coverage does not.** Commit `31d9aba` wired Playwright 1.62.0 outside any
change folder: `playwright.config.ts` (one `chromium` project + a `setup` project producing
`storageState`), `e2e/auth.setup.ts`, `e2e/seed.spec.ts` (manual-add persistence), `e2e/RULES.md`,
and `npm run test:e2e`. Mobile is a per-spec `test.use({ ...devices["Pixel 5"] })` concern, not a
second project — a documented decision (`playwright.config.ts:59-61`: *"the rest of the suite
doesn't pay for a second full run"*).

**Playwright is the only layer in this repo that can execute a React component at all.**
`vitest.config.ts:24-25` sets `environment: "node"` and `include: ["src/**/*.test.ts"]` — `.tsx` is
never collected — and no `jsdom` / `happy-dom` / `@testing-library/*` exists in `package.json` or
`node_modules`. So `PhotoCapture`, `CameraCapture`, and `downscaleImage` have **zero tests at any
layer**, and the cheapest-layer check for Risk #3 is not merely "e2e is cheapest" but "e2e is the
only option that exists."

**What is already owned elsewhere, and must not be re-asserted here.** §6.2's integration suite
covers the identify seam at 37 assertions — both auto-save faces, both abstain faces,
normalization-before-grounding, the base64 payload, the 502 no-leak path, the grounding→columns
mapping, and every threshold boundary (`identify.test.ts:118-286`,
`igdb.integration.test.ts:60-323`, `library.test.ts:106-162`). This phase asserts **journey shape**
only: never a title, an `igdb_id`, or a `metadata_status` value.

**The determinism problem is structural, and it has no existing seam.** `OPENROUTER_ENDPOINT` is a
hardcoded const with no env override (`vision.ts:18`); `identify.ts:142` calls the provider
server-side from the Worker, so `page.route()` is blind to it; and Playwright's `webServer.env`
cannot reach the Worker at all, because wrangler reads `.dev.vars` first and only falls back to
`.env`/`process.env` when that file is **absent**
(`node_modules/wrangler/wrangler-dist/cli.js:297461-297480`) — and `.dev.vars` exists here. The
only deterministic identify outcomes obtainable today are the *failure* and *abstain* ones, neither
of which reaches the saved-and-visible row the risk is about.

**One latent contract gap sits exactly where this phase's assertion lands.** The route returns
`entry` on the persist path (`identify.ts:192`, typed `types.ts:233`) and the island reads
`data.entry` (`PhotoCapture.tsx:146`), but **no test asserts `entry` is present** —
`identify.test.ts:157,173` use `toMatchObject` over `{status, igdbId, metadataStatus}` only.
Dropping `entry` from the route keeps every existing test green while silently degrading the island
to add-mode. `GameDialog.tsx:366`'s `"Edit game"` vs `"Add a game"` title is that gap's only
observable face.

## Desired End State

`npm run test:e2e` runs three specs green against the real local stack, offline, with no provider
key and no live model call:

1. `e2e/seed.spec.ts` — unchanged.
2. `e2e/photo-capture-mobile.spec.ts` — on emulated mobile Chromium with a fake camera: the
   coarse-pointer dropdown → "Take photo" → in-page `getUserMedia` preview → Capture →
   `POST /api/identify` → review dialog opens **as "Edit game"** → close → the row is visible in the
   reloaded SSR list.
3. `e2e/photo-gallery-desktop.spec.ts` — on desktop Chromium: the fine-pointer single button →
   file chooser → the real `downscaleImage` on an image larger than `DEFAULT_MAX_EDGE` → the same
   dialog → the same visible row.

Verification: each spec's risk-carrying assertion has been watched go **red** against a deliberate
break of the production behaviour it targets, and the breaks are reverted and logged in the spec
headers (§6.3's control question, §6.7's falsification-log precedent).

### Key Discoveries

- **`devices["Pixel 5"]` really does flip `pointer: coarse`** — measured (research §Q1, Playwright
  1.62.0 / bundled Chromium 151, 2026-07-27). Both capture branches are always in the DOM,
  differentiated only by `display:none` (`PhotoCapture.tsx:197-240`), so `getByRole("button", {name:
  "Add via photo"})` resolves to **exactly one** element in each mode — no strict-mode violation, no
  `.first()`.
- **`getUserMedia` needs BOTH launch args, and the failure is silent.** Measured: bare Chromium →
  `NotFoundError`; `--use-fake-device-for-media-stream` alone (even with `grantPermissions(["camera"])`)
  → `NotSupportedError`. Without both, `CameraCapture` routes to `onError` and the app falls back to
  the gallery picker — a spec that passes green while exercising the file-input path it was written
  to avoid (research §Q2/§Q4; test-plan §2 Risk #3 names this as the second anti-pattern).
- **`--use-file-for-fake-video-capture=<file.y4m>` is byte-deterministic.** Measured identical JPEG
  output across runs; the stream resolution is the **Y4M's**, not the requested one (research §Q3).
- **`page.route()` *can* intercept `POST /api/identify`** — it is the island's own same-origin
  `fetch` (`PhotoCapture.tsx:137`), not a server-side call. `e2e/RULES.md:49-52`'s caveat is about
  the Worker→OpenRouter/IGDB hop, which remains un-interceptable. This is what makes a
  header-carried test key possible.
- **The seam degrades correctly offline.** With the vision read stubbed to a timestamped title,
  `lookupGameMetadata` still runs; its failure is swallowed at `identify.ts:159-161` → `grounding =
  null` → the row saves as `no_match`. So a network-free CI run produces the *same journey shape*.
- **`downscaleImage` scales only above the bound.** `computeTargetDimensions` returns dimensions
  unchanged when `longEdge <= maxEdge` (`downscale.ts:32-34`, `DEFAULT_MAX_EDGE = 1024`), so a
  gallery fixture at or below 1024 px exercises the pass-through branch and never the resize.
- **The library row is a plain `<tr>` with no id, no `data-*`, no `aria-label`**
  (`index.astro:237-265`), and there are **zero `data-testid` attributes anywhere in `src/`**. Role +
  name-from-content is the whole toolkit, exactly as `seed.spec.ts:33` already does.
- **`sharp` is already a devDependency** (`package.json:69`), so a JPEG fixture can be authored in
  Node without adding anything.

## What We're NOT Doing

- **Mobile Safari, or any browser NFR claim.** `prd.md:173` demands the latest two major versions of
  four browsers across two form factors — a 16-cell matrix. This phase runs Chromium, and
  `devices["Pixel 5"]` is Chromium with a mobile UA. **Decision: `webkit` is declined, in writing**
  (see Implementation Approach for the rationale). Every mobile-Safari claim in §2, §4, and
  `change.md:17` is struck in Phase 5 of this plan so nothing over-claims. The four-browser NFR keeps
  its existing home: the manual matrix at `archive/2026-06-17-photo-to-library/plan.md:230-237`.
- **A real camera, or OS-level page eviction.** The ~80% failure that forced the `<input capture>` →
  `getUserMedia` rewrite was the OS camera app backgrounding/evicting the page and dropping the
  in-flight request (`PhotoCapture.tsx:36-37`,
  `archive/2026-06-17-photo-to-library/plan.md:47`). **No emulator reproduces OS app-switching.** If
  `<input capture>` were reintroduced tomorrow, both specs here would stay green. This is the phase's
  sharpest honesty constraint and belongs in each spec's header.
- **The 10 s p95 latency NFR** (`prd.md:170`). The only measurement on record
  (`archive/2026-06-11-photo-identification-spike/results.md:49-52`, p50 2.56 s / p95 3.25 s)
  explicitly excludes the real phone→Worker uplink, and localhost Playwright will not measure it
  either. Worse, the seam removes the provider call entirely, so this suite's timings are meaningless
  as latency evidence.
- **The real vision provider.** Under the chosen seam the e2e never calls OpenRouter. "The provider
  integration works in the real runtime" moves to manual / pre-prod smoke (§5's optional gate). This
  is the acknowledged cost of the determinism choice.
- **Grounding, metadata, or seam logic.** §6.2 owns it at 37 assertions. No assertion in this phase
  reads a title, an `igdb_id`, or a `metadata_status`.
- **`computeTargetDimensions` arithmetic.** `downscale.test.ts:5-40` covers it in 7 cases. The
  gallery spec exercises `downscaleImage`'s *browser* half (`createImageBitmap` + canvas + encode),
  which is the part no other layer can run.
- **EXIF-orientation correctness.** `downscaleImage` bakes orientation in via
  `createImageBitmap(file, {imageOrientation: "from-image"})` (`downscale.ts:57`). Asserting it needs
  pixel inspection, which is a different instrument (`toMatchSnapshot` / a visual-diff tool) and a
  different risk. Recorded, not covered.
- **The abstain (`unsure`) branch.** It is a real US-01 acceptance criterion (`prd.md:58`, FR-007
  `prd.md:130`) and §6.2 already covers it server-side, but it is not Risk #3 — nothing is saved, so
  the visibility line the risk is about never runs. One test per risk; this one goes unclaimed at
  this layer.
- **The fractional `length_hours` un-editable-row bug.** Phase 3 deferred it here as *"only a browser
  can verify the fix"* (test-plan.md:762-768). **Decision: out of scope, by explicit ruling — it is
  considered solved server-side.** Recorded for the next reader: Phase 3 characterized the defect as
  *browser-side* — `GameFormFields.tsx:197-205` has no `step`, so the browser's implicit `step="1"`
  blocks the whole form submit — so if the symptom recurs it needs its own change with an FR-010
  (`prd.md:140`) oracle, not a rider on this one.
- **F3's abort-but-saved duplication seam.** `archive/2026-06-17-photo-to-library/reviews/impl-review.md`
  F3 is SKIPPED and unfixed: on the 30 s abort the server may already have inserted, so a retry
  duplicates. **Decision: cleanup is tolerant and no row-count is asserted** — converting a rare,
  deliberately-deferred seam belonging to a different risk into intermittent red in this phase's
  headline spec would trade real signal for noise.
- **The `role="status"` "Identifying your game…" overlay** (`PhotoCapture.tsx:170-179`). With the
  provider call removed the overlay may flash by faster than a locator can catch it — an assertion
  that is either racy or vacuous. Recorded in-file as a deliberate omission.

## Implementation Approach

### Decision 1 — Determinism: option (B), a key-guarded test-only seam

Research §Q3 laid out four options. **(B) is chosen.** It is the only one that is simultaneously
deterministic, free, and CI-viable — the three properties §3 Phase 5's e2e gate will need — and,
as noted above, it degrades correctly with no outbound network at all.

The cost is real and is stated rather than minimized: **this is a production code change in a
test-writing phase**, which §7 and every prior phase note treat as the exception. Phase 1 recorded
three code gaps rather than fixing them; Phase 2 made exactly one production edit (a verbatim
function move) and flagged it; Phase 3 recorded four more. The rationale for taking the exception
here:

1. The alternative, (A), does not merely keep production untouched — it *transfers* the cost to
   Phase 5 as a mandatory outbound-network + `OPENROUTER_API_KEY` requirement on the CI e2e gate,
   plus a per-run charge and a model-dependent `identified`-vs-`unsure` branch that makes the spec
   only as stable as one fixture's legibility.
2. (C) removes IGDB deterministically but leaves vision live — it halves the nondeterminism and
   solves none of the important half.
3. (D) is stable and cheap but does not cover the risk: nothing is saved, so the visibility line
   never runs.
4. The seam replaces **the network call only**. The route's multipart contract, size caps, and mime
   validation still run; `vision.ts`'s normalizers still run; grounding, the insert, and the SSR
   re-render are all real. What is stubbed is exactly the nondeterministic hop.

**Guard: two independent locks, both absent in production.** An optional `astro:env/server` variable
must be set **and** the request must carry a header matching its value. Production sets neither, and
`test/stubs/astro-env-server.ts` leaves it `undefined`, so all 228 existing Vitest tests run with the
seam provably disarmed. Phase 1 proves the guard at the Vitest layer rather than trusting the e2e to
notice.

### Decision 2 — Phase 5's CI contract, stated now rather than discovered

Choosing (B) means the e2e gate needs **no outbound network and no `OPENROUTER_API_KEY`**. It does
need the seam key reachable by the dev server, and that is not free: `.dev.vars` is gitignored and
beats `process.env`, so CI must **write `.dev.vars` from repository secrets before starting the
server** — the same file the local flow already uses, one mechanism for both. This is recorded as a
Phase 5 requirement in §5 and §4 so Phase 5 inherits the answer instead of rediscovering the
precedence gotcha.

### Decision 3 — `webkit`: declined, in writing

Adding a `webkit` project would buy roughly one more of 16 NFR cells while doubling this phase's
runtime, and — decisively — **the fake-media launch args are Chromium-only**, so the camera spec
could not run on WebKit at all. A webkit run of it would silently exercise the file-input path,
which is anti-pattern #2 under a different name. WebKit is also not iOS Safari. The gap is real and
is recorded rather than papered over.

### Decision 4 — Both capture paths, in separate files

The camera path is what Risk #3 names and what the pointer split gates — it is literally unreachable
on a fine pointer. The gallery path is the only thing that exercises `downscaleImage`, untested at
every layer and architecturally mandatory (workerd has no `sharp`, `identify.ts:33-36`). They ship as
**two files, one test each**, honoring §6.3's one-test-per-file rule; the split also lets each run on
the form factor where it is the real affordance, which turns the pointer split itself into an
assertion from both sides.

### Decision 5 — Fixtures: tiny, synthetic, generated in-repo

Under the seam the pixel content is never seen by a model, so legibility is irrelevant and a small
committed fixture keeps runs hermetic with no `ffmpeg` dependency (research §Q5 flags depending on
Playwright's bundled binary as fragile). A committed generator script writes both; the outputs are
committed alongside it.

## Critical Implementation Details

**`.dev.vars` precedence and the stale-server trap.** Wrangler reads `.dev.vars` first and consults
`process.env` only when that file is absent (`cli.js:297461-297480`), and Astro binds secrets once at
worker init (`astro/dist/env/vite-plugin-env.js:143-148`) — so a `.dev.vars` edit needs a **dev-server
restart**. `playwright.config.ts:69` sets `reuseExistingServer: !IS_CI`, so a server already running
from before the seam key was added will silently keep the old (empty) value and the spec will fail
with the real provider's error rather than an obvious "key missing". Kill any running dev server
after editing `.dev.vars`.

**Two copies of the key, deliberately.** `E2E_VISION_STUB_KEY` must exist in **`.dev.vars`** (the
server reads it) *and* **`.env`** (Node-side; `playwright.config.ts:22` loads it so the spec can send
the header). They must match. This is the same additive pattern `E2E_EMAIL`/`E2E_PASSWORD` already
uses, and the reason is documented at `playwright.config.ts:18-20`.

**Locator punctuation.** `UNSURE_NOTICE` (`PhotoCapture.tsx:24`) uses U+2019 (`’`) and an em dash;
several error strings do too (`:95,153,155`). An ASCII `couldn't` will not match. Copy literals from
source. (Not needed by the two specs planned here, but it is the trap the next spec in this
directory will hit.)

**The file input has no accessible name.** `PhotoCapture.tsx:189-195` — no label, no id, no role.
Prefer Playwright's `filechooser` event (triggered by the role-located button) over
`page.locator('input[type="file"]')`; the former stays inside `e2e/RULES.md`'s locator rules. Where a
CSS selector is unavoidable it is a gap in the app's accessibility, not a rule violation to hide —
say so in-file.

**`hover: false`, `maxTouchPoints: 1` under Pixel 5.** The Radix `DropdownMenu` opens on pointerdown;
Playwright's `.click()` on a `hasTouch` context still synthesizes mouse events. Expected to work, but
it is the most likely first-run surprise — reach for `.tap()` only if `.click()` misbehaves, and
record which was needed.

**`launchOptions` is per-file-able.** `test.use({ ...devices["Pixel 5"], launchOptions: { args: [...] } })`
is valid — `launchOptions` is a `TestOptions` field (Context7 `/microsoft/playwright`,
`class-testoptions.md`, **checked 2026-07-27**). Overriding it forces a fresh browser for that
worker, which is acceptable for one spec and consistent with `playwright.config.ts:59-61`'s rationale.

**`setInputFiles` runs no actionability checks**, so a `display:none` input is fine — confirmed at
source level (`packages/playwright-core/src/server/dom.ts`; Context7 `/microsoft/playwright`,
**checked 2026-07-27**).

---

## Phase 1: The determinism seam and its guard

### Overview

Add the smallest production seam that makes `POST /api/identify` deterministic for a request that
proves knowledge of a server-side key, and prove at the Vitest layer that it cannot fire otherwise.
This lands first because it has the largest blast radius in the phase and the cheapest possible
verification — leaving the guard to be validated by an e2e would be exactly backwards.

### Changes Required:

#### 1. Env schema

**File**: `astro.config.mjs`

**Intent**: Declare the seam's key so `vision.ts` can read it through `astro:env/server` like every
other secret, and so an unset key is a first-class state rather than an undefined global.

**Contract**: A new `E2E_VISION_STUB_KEY` entry in `env.schema`, `context: "server"`, `access:
"secret"`, `optional: true` — matching the four existing entries at `astro.config.mjs:29-33`.
Optional is load-bearing: builds, CI, and production must proceed without it.

#### 2. The seam and its guard

**File**: `src/lib/services/vision.ts`

**Intent**: Export a pure guard that turns request headers into either a canned identified read or
`null`, so the decision is auditable in one place and the route stays a two-line call site. It
replaces the OpenRouter hop only — the normalizers stay on the path, so the value that reaches the
insert is the same shape the real provider's would be.

**Contract**: `stubbedVisionRead(headers: Headers): VisionIdentifyResult | null`. Returns `null` —
falling through to the real provider — unless **all** of: `E2E_VISION_STUB_KEY` is set and non-empty;
the request carries a key header whose value equals it; and a title header is present and non-empty.
On success returns `{ status: "identified", title: normalizeTitleCasing(<title header>), platform:
normalizePlatformLabel(<platform header, defaulted>), confidence: 1 }`. Header names are module
constants (suggested: `x-e2e-vision-key`, `x-e2e-vision-title`, `x-e2e-vision-platform`). No
throwing: every failed check is a `null`, never a 4xx, so a malformed test request degrades to the
production path rather than to a confusing error.

#### 3. Route wiring

**File**: `src/pages/api/identify.ts`

**Intent**: Consult the seam immediately before the provider call, leaving every line above it — auth
gate, `formData()` parse, `uploadSchema` validation, the base64 encode — on the real path, so the
e2e still exercises the full request contract.

**Contract**: Between `:136` (the `dataUrl` build) and `:140-148` (the vision try/catch), branch on
`stubbedVisionRead(request.headers)`: when non-null, use it as `vision` and skip
`identifyGameFromPhoto`; when null, the existing try/catch runs unchanged. Everything downstream —
`unsure` fold, grounding, persist, response shape — is untouched.

#### 4. Env stub

**File**: `test/stubs/astro-env-server.ts`

**Intent**: Leave the seam disarmed for the entire existing suite, so all 228 tests stand as
continuous evidence that the default state is dead.

**Contract**: Export `E2E_VISION_STUB_KEY` as `undefined` (contrast with the non-empty dummy
`OPENROUTER_API_KEY` the stub supplies so the real vision path runs — see §6.2).

#### 5. Guard tests

**File**: `src/lib/services/vision.test.ts` (new)

**Intent**: Prove the guard's three locks independently, at the layer that can do it in milliseconds.

**Contract**: A hoisted-holder mock of `astro:env/server` so each test controls the key value
(§6.4's `vi.hoisted` holder pattern is the precedent). Four cases:
- key unset + correct headers → `null` (**the production-safety assertion**);
- key set + no header → `null`;
- key set + mismatched header → `null`;
- key set + matching header + title → an `identified` result whose `title`/`platform` are the
  **normalized** forms (pass a lowercase title and a platform alias; assert the normalizers ran —
  this is what keeps the seam from bypassing §6.2's load-bearing normalization).

- **Behavior asserted**: the seam is unreachable without both locks; when reachable it yields a
  normalized identified read.
- **Regression caught**: a guard that degrades to key-presence-only, or to header-presence-only —
  either of which would let a leaked variable disable identification in a real environment.
- **Research source**: §Q3 (no seam exists; four options), Open Question 1 (option B needs "a
  key-guard so it cannot fire in production").
- **Edge/boundary**: empty-string key treated as unset — the boundary between "declared optional and
  absent" and "declared and set", which `astro:env`'s optional secrets make easy to conflate.
- **Anti-pattern avoided**: proving a production-safety property with an expensive, flake-prone
  browser test instead of a 5 ms unit test.

#### 6. Documentation of the exception

**File**: `.env.example`

**Intent**: Make the two-copies requirement and the "never set in production" rule discoverable at
the place a developer configures the project.

**Contract**: An `E2E_VISION_STUB_KEY` block following the existing comment style
(`.env.example:10-16`), stating: any non-empty value; must be identical in `.dev.vars` (server) and
`.env` (spec side); a dev-server restart is required after editing `.dev.vars`; and that setting it in
production disables photo identification for anyone who knows the value.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- The new guard suite passes: `npx vitest run src/lib/services/vision.test.ts`
- The full existing suite is unaffected: `npm test` (228 tests, all with the seam disarmed)

#### Manual Verification:

- With `E2E_VISION_STUB_KEY` unset in `.dev.vars`, a real photo upload through the UI still reaches
  the provider and behaves exactly as before.
- Deleting the `!E2E_VISION_STUB_KEY` check turns the "key unset → null" test red (a hand-run
  falsification of the guard's own test, immediately reverted).

**Implementation Note**: pause here for manual confirmation before proceeding.

---

## Phase 2: Harness scaffolding and fixtures

### Overview

Produce the two fixtures and prove — before a single assertion is written — that `getUserMedia`
actually succeeds under the launch args in *this* app. This ordering exists because the failure mode
is silent: without both args the app falls back to the file picker and a camera spec passes green
while testing the wrong path.

### Changes Required:

#### 1. Fixture generator

**File**: `scripts/make-e2e-fixtures.mjs` (new)

**Intent**: Author both fixtures reproducibly from committed code rather than opaque binaries, so a
future reader can see exactly what they are and regenerate them.

**Contract**: Writes two files into `e2e/fixtures/`:
- `box.y4m` — a single-frame 320×240 solid-colour Y4M (~113 KB). This is the exact geometry research
  measured working. The format is a plain-text header, then `FRAME\n`, then raw planar bytes — no
  encoder needed:

  ```
  YUV4MPEG2 W320 H240 F25:1 Ip A1:1 C420\n
  FRAME\n
  <320*240 Y bytes><160*120 U bytes><160*120 V bytes>
  ```

- `box.jpg` — via the existing `sharp` devDependency (`package.json:69`), a **1600×1200** solid or
  simple-gradient JPEG. The dimensions are the point: `computeTargetDimensions` returns input
  unchanged when the long edge is `<= 1024` (`downscale.ts:32-34`), so a smaller fixture would
  exercise the pass-through branch and never the resize. A flat image compresses to a few KB at that
  size.

#### 2. Fixtures

**File**: `e2e/fixtures/box.y4m`, `e2e/fixtures/box.jpg` (new, committed)

**Intent**: Keep runs hermetic and reproducible with no runtime image dependency.

**Contract**: Committed outputs of the generator. A short `e2e/fixtures/README.md` records what they
are, that the seam makes their content irrelevant, and the one property that is *not* irrelevant
(`box.jpg` must stay above 1024 px on its long edge).

#### 3. Launch-args probe, folded into the spec's own assertions

**File**: (verification step; no permanent file)

**Intent**: Confirm empirically that both args are needed and sufficient here, and identify the
permanent assertion that will keep the check alive.

**Contract**: The permanent guard is already in the app: `CameraCapture`'s Capture button is
`disabled={!ready}` (`:166`) and `ready` flips only after `getUserMedia` resolves (`:80`). So
**"the camera dialog is visible and its Capture button is enabled" is equivalent to "getUserMedia
succeeded"** — that assertion, inside the camera spec, is the permanent anti-pattern guard. Run the
probe by launching with each arg alone and confirming the dialog never reaches an enabled Capture.

### Success Criteria:

#### Automated Verification:

- Generator runs clean: `node scripts/make-e2e-fixtures.mjs`
- Both fixtures exist and `box.jpg` reports a long edge > 1024 px
- Lint passes: `npm run lint`

#### Manual Verification:

- With both args, a scratch run reaches an **enabled** Capture button.
- With `--use-fake-ui-for-media-stream` removed, it does not (the app surfaces a camera error and
  falls back) — confirming the guard assertion discriminates.

**Implementation Note**: pause here for manual confirmation before proceeding.

---

## Phase 3: The Risk #3 camera spec

### Overview

The phase's headline spec, and the only one that touches the affordance Risk #3 names. Highest
signal, highest cost — it runs after the two cheaper phases have removed its two biggest failure
modes (a nondeterministic provider, a silently-wrong capture path).

### Changes Required:

#### 1. The spec

**File**: `e2e/photo-capture-mobile.spec.ts` (new)

**Intent**: Drive the complete mobile journey — coarse-pointer dropdown → in-page camera → identify →
auto-save → **visible row** — and assert the two things that carry the risk.

**Contract**: One test, modeled on `e2e/seed.spec.ts`. File-level
`test.use({ ...devices["Pixel 5"], launchOptions: { args: [...] } })`; `storageState` is inherited
from the `chromium` project, so the spec never logs in.

The launch args, all three load-bearing (the Y4M path must be absolute — resolve it via
`fileURLToPath(new URL("fixtures/box.y4m", import.meta.url))`):

```ts
args: [
  "--use-fake-device-for-media-stream",   // without this: NotFoundError
  "--use-fake-ui-for-media-stream",       // without this: NotSupportedError — silently falls back
  `--use-file-for-fake-video-capture=${Y4M_PATH}`,
]
```

The seam is armed per-request by intercepting the island's **own same-origin** fetch and adding
headers before continuing — not by mocking a response:

```ts
await page.route("**/api/identify", async (route) => {
  await route.continue({
    headers: { ...route.request().headers(), "x-e2e-vision-key": KEY, "x-e2e-vision-title": title },
  });
});
```

Journey: `goto("/library")` → `getByRole("button", {name: "Add via photo"})` (resolves to exactly one
— the dropdown trigger, because the fine-pointer branch is `display:none`) → `getByRole("menuitem",
{name: "Take photo"})` → `getByRole("dialog", {name: "Take a photo of the game box"})` visible with
Capture **enabled** → Capture → `waitForResponse("**/api/identify")` → `getByRole("dialog", {name:
"Edit game"})` → Close → `waitForURL("**/library")` → `getByRole("row", {name: new RegExp(title)})`
visible. Cleanup: delete every row matching the title until `toHaveCount(0)`.

The header comment states the honest scope verbatim — *this proves the app's own mobile wiring on
emulated mobile Chromium; it does not prove mobile Safari, a real camera, OS-level page eviction (the
~80% failure that forced the `<input capture>` → `getUserMedia` rewrite is invisible to every
emulator), or the 10 s p95 latency NFR* — plus the three deliberate omissions (the overlay, the row
count under F3, metadata) and why.

- **Behavior asserted**: on a coarse pointer, capture → identify → auto-save → **entry visible in the
  reloaded SSR list**, with no required desktop step.
- **Regression caught**: (i) removal or breakage of `window.location.assign("/library")`
  (`PhotoCapture.tsx:259-261`) — the row saves and is never seen; (ii) the route dropping `entry` from
  its persist response (`identify.ts:192`), which degrades the dialog to add-mode and which **no
  existing test catches** (`identify.test.ts:157,173` assert only `{status, igdbId, metadataStatus}`);
  (iii) the mobile capture affordance disappearing or the camera failing to open.
- **Research source**: §Q1 (measured pointer-coarse flip, single-element resolution), §Q2 (the
  request contract, the three outcomes, the dialog-title discriminant, the navigation seam), §Q3
  (launch args, Y4M determinism), §Q5 (the untested `entry` contract).
- **Edge/error/boundary**: the enabled-Capture assertion is the boundary between a real `getUserMedia`
  stream and the silent file-input fallback — the exact failure research measured. `waitForResponse`
  is the state-based wait that replaces any temptation toward a timeout.
- **Anti-pattern avoided**: no title, `igdb_id`, or `metadata_status` assertion (§6.2 owns those at
  37 assertions); no fake-camera-args omission; no `waitForTimeout`; no overlay assertion that would
  be racy under a stubbed read.

### Success Criteria:

#### Automated Verification:

- Spec passes: `npm run test:e2e -- e2e/photo-capture-mobile.spec.ts`
- Whole suite still green: `npm run test:e2e`
- Lint passes: `npm run lint`

#### Manual Verification:

- The run leaves no rows behind in the local library (check the UI after the run).
- Whether `.click()` or `.tap()` was needed for the Radix dropdown under `hasTouch` is recorded
  in-file (research Open Question 6).

**Implementation Note**: pause here for manual confirmation before proceeding.

---

## Phase 4: The gallery spec

### Overview

Lower risk-signal than Phase 3, but it is the only test at any layer that executes `downscaleImage`,
and it closes the pointer split from the other side: on a fine pointer there is one button and **no**
camera affordance at all.

### Changes Required:

#### 1. The spec

**File**: `e2e/photo-gallery-desktop.spec.ts` (new)

**Intent**: Exercise the gallery path end to end on the default desktop project, forcing the real
browser downscale on an oversized image.

**Contract**: One test, no `test.use` device override and no launch args — it runs on the existing
`chromium` (Desktop Chrome) project, which is the point: the fine-pointer branch is the one under
test. Same `page.route` header injection as Phase 3, same timestamped title, same tolerant cleanup.

File selection goes through Playwright's `filechooser` event triggered by the role-located button,
keeping the spec inside `e2e/RULES.md`'s locator rules; `page.locator('input[type="file"]')` is the
documented fallback if the event does not fire on the island's programmatic `.click()`
(`PhotoCapture.tsx:66`). Whichever is used, the in-file comment records that the input carries no
label, id, or role (`PhotoCapture.tsx:189-195`) — an accessibility gap, not a rule bent quietly.

Two assertions specific to this spec: exactly one `"Add via photo"` button resolves, and **no**
`"Take photo"` menuitem exists in this context.

- **Behavior asserted**: on a fine pointer, choose-from-gallery → real client-side downscale →
  identify → auto-save → visible row; and the camera affordance is genuinely absent.
- **Regression caught**: a break in `downscaleImage`'s browser half (`createImageBitmap` / canvas /
  `toBlob`, `downscale.ts:52-86`), which surfaces to the user as *"Couldn't read that image"*
  (`PhotoCapture.tsx:95`) and is untested at every layer; and a CSS regression that leaks the camera
  affordance onto desktop — the literal "a desktop step sneaks in" clause of Risk #3, inverted.
- **Research source**: §Q1 (the gallery input's missing accessible name; `setInputFiles` skips
  actionability checks), §Q4 (the real `createImageBitmap` → canvas → JPEG path "has no test
  anywhere"), §Q5 (`downscaleImage` untested; only its arithmetic helper is covered).
- **Edge/error/boundary**: the fixture is **1600×1200**, above `DEFAULT_MAX_EDGE = 1024`, so the
  scaling branch runs rather than the pass-through — the boundary `downscale.ts:32-34` draws.
- **Anti-pattern avoided**: not re-asserting `computeTargetDimensions` arithmetic (7 cases already in
  `downscale.test.ts:5-40`); not asserting output pixel dimensions, which would mirror the
  implementation rather than the user-visible outcome.

### Success Criteria:

#### Automated Verification:

- Spec passes: `npm run test:e2e -- e2e/photo-gallery-desktop.spec.ts`
- Whole suite green: `npm run test:e2e`
- Lint passes: `npm run lint`

#### Manual Verification:

- No rows left behind after the run.
- Which file-selection mechanism was needed (`filechooser` vs. the locator fallback) is recorded
  in-file.

**Implementation Note**: pause here for manual confirmation before proceeding.

---

## Phase 5: Falsification and documentation

### Overview

§6.3's control question — *would this fail if the risk actually came true?* — answered by
experiment, not by assertion; then the plan's findings backported into the foundation documents so
the next reader inherits them. §6.7's pgTAP falsification table is the precedent for recording what
was watched go red.

### Changes Required:

#### 1. Falsification log

**File**: `e2e/photo-capture-mobile.spec.ts`, `e2e/photo-gallery-desktop.spec.ts` (header comments)

**Intent**: Turn "these tests pass" into "these tests discriminate", with evidence a reader can
check.

**Contract**: Three breaks, each applied to a scratch working tree, run, observed, and **reverted —
never committed**:
1. Comment out `window.location.assign("/library")` (`PhotoCapture.tsx:259-261`) → the camera spec's
   final row assertion must go red. *This is the risk itself.*
2. Drop `entry` from the persist response (`identify.ts:192`) → the `"Edit game"` dialog assertion
   must go red (and every existing Vitest test must stay green — that contrast is the point, and it
   is the untested contract gap §Q5 identified).
3. Remove `--use-fake-ui-for-media-stream` → the enabled-Capture assertion must go red, proving the
   spec is not silently on the file-input path.

Each spec header carries a short table: break → which assertion reddens. Any break that leaves the
suite green means the assertion is decorative and must be fixed before the phase closes.

#### 2. E2E rules

**File**: `e2e/RULES.md`

**Intent**: Record the three techniques this phase invented so the next spec reproduces them
correctly — RULES.md and `seed.spec.ts` are this layer's two quality levers.

**Contract**: Additions to the "Real vs mocked" and "The rules" sections: the seam and how to arm it;
that `page.route()` **can** intercept the app's own same-origin `/api/identify` (sharpening the
existing server-side caveat at `:49-52`, which stays true for the Worker→provider hop); the two
mandatory fake-media launch args and why omitting one fails silently; and the `filechooser` idiom as
the sanctioned way to reach an unlabeled file input.

#### 3. Test plan — cookbook

**File**: `context/foundation/test-plan.md` §6.3

**Intent**: Replace "Still owed: Risk #3" with the patterns actually shipped.

**Contract**: Remove the **Still owed** block (`:248-249`). Add: the two reference specs and what each
owns; the mobile-emulation recipe (per-file `test.use` with device + `launchOptions`, and why not a
second project); the determinism seam, its double guard, and the rule that a seam replaces the
network hop and never the normalizers; the falsification-log convention; and the two anti-patterns
with their observable symptoms.

#### 4. Test plan — status, stack, gates, exclusions

**File**: `context/foundation/test-plan.md` §3, §4, §5, §7, §6.8, §8

**Intent**: Make the plan's own record match what shipped, including the parts that are gaps.

**Contract**:
- §3 Phase 4 Status → `complete`.
- §4 e2e row: Playwright still 1.62.0; note the seam, the fixtures, and that the run is now offline
  and provider-free. **Strike the mobile-Safari implication** and state the webkit decline with its
  reason (Chromium-only fake-media args).
- §5: the e2e gate row gains its Phase 5 contract — no outbound network, no `OPENROUTER_API_KEY`,
  but `.dev.vars` must be written from CI secrets before the dev server starts, because `.dev.vars`
  beats `process.env`.
- §7: a new bullet recording the production-change exception — what the seam is, why the exception
  was taken, how it is guarded, and that the real provider integration therefore moves to manual /
  pre-prod smoke.
- §6.8: a Phase 4 note covering the seam decision, the webkit decline, the silent-launch-args trap,
  the `>1024 px` fixture requirement, and the F3 cleanup tolerance.
- §8: refresh the freshness ledger with today's date and what was re-verified.

#### 5. Change identity

**File**: `context/changes/testing-e2e-photo-flow/change.md`

**Intent**: Close the loop and remove the one over-claim it carries.

**Contract**: `status: complete`, `updated:` today. Correct `:17`'s *"on a real mobile browser"* to
the emulated scope this phase actually delivers.

### Success Criteria:

#### Automated Verification:

- Full e2e suite green from a cold start: `npm run test:e2e`
- Full unit/integration suite green: `npm test`
- Lint + typecheck pass: `npm run lint`, `npm run typecheck`
- No break is left in the working tree: `git diff` over `src/` shows only the Phase 1 seam

#### Manual Verification:

- Each of the three breaks was observed red and is documented in the spec headers.
- §6.3 no longer says Risk #3 is owed, and no document in `context/foundation/` claims mobile-Safari
  or four-browser coverage.
- A reader who knows nothing about this phase can tell, from the spec headers alone, what the green
  run does and does not prove.

---

## Testing Strategy

### Unit Tests:

- The seam guard's four cases (`src/lib/services/vision.test.ts`) — the three `null` locks and the
  normalized success, per Phase 1.
- The 228 existing tests act as a standing assertion that the seam is disarmed by default, because
  `test/stubs/astro-env-server.ts` leaves the key `undefined`.

### Integration Tests:

- None added. §6.2 already owns the identify seam at 37 assertions; adding more here is the
  anti-pattern §2 Risk #3 names by name.

### E2E Tests:

- `e2e/photo-capture-mobile.spec.ts` — Risk #3's journey on emulated mobile Chromium with a fake
  camera.
- `e2e/photo-gallery-desktop.spec.ts` — the fine-pointer gallery journey and the real
  `downscaleImage`.

### Manual Testing Steps:

1. `npx supabase start`, ensure `.dev.vars` and `.env` both carry a matching `E2E_VISION_STUB_KEY`,
   and **restart any running dev server**.
2. `npm run test:e2e` — all three specs green; the library is empty of test rows afterward.
3. Unset `E2E_VISION_STUB_KEY` in `.dev.vars`, restart the dev server, and add a game via photo
   through the real UI — the real provider path is unchanged.
4. Apply falsification break 1, run the camera spec, watch it go red, revert.

## Performance Considerations

The camera spec overrides `launchOptions`, which forces a fresh browser for that worker. That is the
cost `playwright.config.ts:59-61` was avoiding when it declined a second mobile project, and it is
paid by one spec instead of the whole suite. The seam removes the provider round-trip (~2.5 s p50 per
research's spike measurements), so the specs are faster than a real-provider run would be — and,
correspondingly, this suite is worthless as latency evidence.

## Migration Notes

No data migration. Two operational notes for anyone running the suite after this lands: the seam key
must exist in **both** `.dev.vars` and `.env`, and a `.dev.vars` edit requires a dev-server restart
(`reuseExistingServer: !IS_CI` will otherwise reuse a server holding the old value).

## References

- Research: `context/changes/testing-e2e-photo-flow/research.md`
- Change identity: `context/changes/testing-e2e-photo-flow/change.md`
- Test plan: `context/foundation/test-plan.md` §2 Risk #3, §3 Phase 4, §4 e2e row, §6.3, §7
- E2E rules and exemplar: `e2e/RULES.md`, `e2e/seed.spec.ts`
- The risk in one line: `src/components/library/PhotoCapture.tsx:254-262`
- The capture split: `src/components/library/PhotoCapture.tsx:197-240`
- The dialog discriminant: `src/components/library/GameDialog.tsx:366`
- The untested downscale: `src/lib/image/downscale.ts:52-86`
- The historical failure this risk descends from: `context/archive/2026-06-17-photo-to-library/plan.md:47`
- The deferred F3 seam: `context/archive/2026-06-17-photo-to-library/reviews/impl-review.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The determinism seam and its guard

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — 3e78f42
- [x] 1.2 Lint passes: `npm run lint` — 3e78f42
- [x] 1.3 The new guard suite passes: `npx vitest run src/lib/services/vision.test.ts` — 3e78f42
- [x] 1.4 The full existing suite is unaffected: `npm test` — 3e78f42

#### Manual

- [x] 1.5 Seam unset → the real provider path is unchanged through the UI — 3e78f42
- [x] 1.6 Deleting the key check turns the "key unset → null" test red, then reverted — 3e78f42

### Phase 2: Harness scaffolding and fixtures

#### Automated

- [x] 2.1 Generator runs clean: `node scripts/make-e2e-fixtures.mjs` — 2a7850b
- [x] 2.2 Both fixtures exist and `box.jpg`'s long edge is > 1024 px — 2a7850b
- [x] 2.3 Lint passes: `npm run lint` — 2a7850b

#### Manual

- [x] 2.4 With both args, a scratch run reaches an enabled Capture button — 2a7850b
- [x] 2.5 With one arg removed, it does not — the guard assertion discriminates — 2a7850b

### Phase 3: The Risk #3 camera spec

#### Automated

- [x] 3.1 Spec passes: `npm run test:e2e -- e2e/photo-capture-mobile.spec.ts` — c72835f
- [x] 3.2 Whole suite still green: `npm run test:e2e` — c72835f
- [x] 3.3 Lint passes: `npm run lint` — c72835f

#### Manual

- [x] 3.4 No rows left behind in the local library after the run — c72835f
- [x] 3.5 `.click()` vs `.tap()` outcome for the Radix dropdown recorded in-file — c72835f

### Phase 4: The gallery spec

#### Automated

- [x] 4.1 Spec passes: `npm run test:e2e -- e2e/photo-gallery-desktop.spec.ts` — 7e45c25
- [x] 4.2 Whole suite green: `npm run test:e2e` — 7e45c25
- [x] 4.3 Lint passes: `npm run lint` — 7e45c25

#### Manual

- [x] 4.4 No rows left behind after the run — 7e45c25
- [x] 4.5 File-selection mechanism used (`filechooser` vs fallback) recorded in-file — 7e45c25

### Phase 5: Falsification and documentation

#### Automated

- [x] 5.1 Full e2e suite green from a cold start: `npm run test:e2e`
- [x] 5.2 Full unit/integration suite green: `npm test`
- [x] 5.3 Lint + typecheck pass: `npm run lint`, `npm run typecheck`
- [x] 5.4 No break left in the tree: `git diff` over `src/` shows only the Phase 1 seam

#### Manual

- [x] 5.5 All three breaks observed red and documented in the spec headers
- [x] 5.6 §6.3 no longer lists Risk #3 as owed; no foundation doc claims mobile-Safari coverage
- [x] 5.7 Spec headers alone convey what the green run does and does not prove
