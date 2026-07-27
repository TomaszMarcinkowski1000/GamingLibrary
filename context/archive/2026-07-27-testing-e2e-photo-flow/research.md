---
date: 2026-07-27T18:14:53Z
researcher: Tomasz Marcinkowski
git_commit: 31d9abaa5b6f7294504d20017b221f90b21b5bca
branch: main
repository: GamingLibrary
topic: "Rollout Phase 4 — end-to-end mobile photo flow (Risk #3): grounding the browser capture journey, its determinism levers, and the honest scope of one e2e spec"
tags: [research, codebase, e2e, playwright, photo-capture, identify, mobile, risk-3]
status: complete
last_updated: 2026-07-27
last_updated_by: Tomasz Marcinkowski
---

# Research: Rollout Phase 4 — End-to-end photo flow (Risk #3)

**Date**: 2026-07-27T18:14:53Z
**Researcher**: Tomasz Marcinkowski
**Git Commit**: `31d9aba` (Playwright harness wired, no Phase 4 coverage yet)
**Branch**: main
**Repository**: GamingLibrary

## Research Question

Ground Phase 4 of `context/foundation/test-plan.md` — Risk #3: *"the end-to-end photo journey breaks
on a mobile browser — camera capture → identify → auto-saved entry never lands visibly, or a
desktop-only step sneaks in."* Verify (not accept) the §2 risk-response guidance, answer five
specific questions with quoted code, locate where existing coverage ends, confirm e2e is genuinely
the cheapest remaining layer, and flag anything speculative or misleading.

## Summary

**The risk is real and e2e is genuinely the only layer that can see it.** There are zero React
component tests in this repo and the harness structurally cannot run one (`vitest.config.ts:24`
`environment: "node"`, `include: ["src/**/*.test.ts"]` — `.tsx` is not even collected, and neither
`jsdom` nor `happy-dom` nor `@testing-library/*` is installed). **Playwright is the only layer in
this project that can execute a React component at all.** Every DOM behaviour of the photo journey
— the pointer-split capture affordance, the blocking overlay, the identified-vs-unsure dialog
branch, the post-close navigation that is the *only* thing making the saved row visible — is
currently unasserted at every layer. That is a genuine, non-duplicative gap.

**Six findings change what the plan should build:**

1. **The mobile capture affordance is gated behind a pure-CSS `@media (pointer: coarse)` split**
   (`PhotoCapture.tsx:199,210`), and I **measured** that Playwright's `devices["Pixel 5"]` does make
   Chromium report `pointer: coarse` — so the mobile branch is reachable and `getByRole` resolves to
   exactly one button in each mode. This was the single biggest "verify before planning" unknown and
   it comes out green. §Q1.
2. **`getUserMedia` fails under Playwright unless launch args are set — and the failure is silent.**
   Measured: bare Chromium → `NotFoundError`; `--use-fake-device-for-media-stream` alone (even with
   `grantPermissions(["camera"])`) → `NotSupportedError`. Only `--use-fake-device-for-media-stream`
   **plus** `--use-fake-ui-for-media-stream` works. Without them `CameraCapture` routes to
   `onError(…)` and the app falls back to the gallery picker — producing a spec that passes green
   while testing the *file-input* path it was written to avoid. §Q4.
3. **`--use-file-for-fake-video-capture=<file.y4m>` feeds a deterministic frame.** Measured
   byte-identical output across runs. So an arbitrary fixture image *can* reach the canvas → JPEG →
   `/api/identify` pipeline through the real camera path. §Q3.
4. **There is no vision/IGDB seam. None. Confirmed, not assumed.** No `import.meta.env.DEV` branch,
   no stub flag, no configurable endpoint (`OPENROUTER_ENDPOINT` is a hardcoded const,
   `vision.ts:18`). And Playwright's `webServer.env` **cannot** reach the Worker: wrangler's
   `getVarsForDev` reads `.dev.vars` first and only falls back to `.env`/`process.env` when that
   file is *absent* (`node_modules/wrangler/wrangler-dist/cli.js:297461-297480`), and `.dev.vars`
   exists here. Four options with real trade-offs are laid out in §Q3; **the plan must pick one, and
   one of them is a production code change.**
5. **The §2 must-challenge line is unsatisfiable by the configured harness.** "'works on desktop
   Chrome' is not 'works on mobile Safari camera'" — a Chromium-only harness with a Chromium-based
   Pixel 5 descriptor cannot run mobile Safari at all. And more seriously: **the historical failure
   that produced this risk is invisible at this layer.** The ~80% failure that forced the
   `<input capture>` → `getUserMedia` rewrite was *the OS camera app evicting the page and dropping
   the in-flight fetch* (`PhotoCapture.tsx:36-37`). No emulation reproduces OS app-switching. If
   `<input capture>` were reintroduced tomorrow, an emulated Pixel 5 spec would stay green. §Q4.
6. **"interview Q4" does not exist on disk** — it is the *only* likelihood evidence separating
   Risk #3 from a purely PRD-derived risk. Real, dated, quotable equivalents exist
   (`roadmap.md:150`, `photo-to-library/change.md:20`) and say the same thing. §Evidence audit.

**Verdict on the layer choice: confirmed.** §6.2's integration suite already owns the seam logic
(37 assertions across `identify.test.ts` / `igdb.integration.test.ts` / `library.test.ts`), and it
owns it well — including both auto-save faces. What it cannot see is everything between the user's
thumb and the rendered row. One spec, correctly scoped, is owed.

---

## Detailed Findings

### Q1 — The browser capture entry point

**Two capture paths, split by pointer type in pure CSS, not JS** —
`src/components/library/PhotoCapture.tsx:197-240`:

```tsx
{/* Desktop (fine pointer): one button → the gallery/file picker. */}
<Button className="[@media(pointer:coarse)]:hidden" onClick={() => { pick(galleryInputRef); }} disabled={pending}>
  <Camera />
  {buttonLabel}
</Button>

{/* Mobile (coarse pointer): a dropdown splitting camera vs. gallery. */}
<div className="hidden [@media(pointer:coarse)]:block">
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button disabled={pending}><Camera />{buttonLabel}<ChevronDown /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => { …; setCameraOpen(true); }}><Camera />Take photo</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { pick(galleryInputRef); }}><ImageIcon />Choose from gallery</DropdownMenuItem>
```

`buttonLabel = pending ? "Identifying…" : "Add via photo"` (`:164`). **Both branches are always in
the DOM**; only `display:none` differentiates them. That is the load-bearing fact for the spec: on a
fine pointer there is **one button and no "Take photo" affordance at all** — the camera path is
literally unreachable on desktop.

**Is a real camera required? Measured answer: it depends on which path you drive.**

| Path | Element the test drives | Real camera needed? |
|---|---|---|
| Gallery (both pointers) | `<input type="file" accept="image/*" className="hidden">` (`:189-195`) | **No** — `setInputFiles` |
| Camera (coarse only) | `menuitem "Take photo"` → `CameraCapture` → `button "Capture"` | **A fake one** — Chromium launch args |

The gallery input has **no label, no id, no role** — `setInputFiles` must reach it via
`page.locator('input[type="file"]')` or the `filechooser` event. Note this is the one place a spec
must break `e2e/RULES.md`'s "never use CSS selectors" rule; a file input exposes no accessible name
to target. Worth calling out in the plan rather than discovering at review.

**Measured empirically** (Playwright 1.62.0, bundled Chromium 151.0.7922.34, 2026-07-27, against a
synthetic page reproducing the same CSS split and a `display:none` file input, served over
`http://localhost`):

```
=== Desktop Chrome ===  {"coarse":false,"fine":true,"hover":true,"maxTouchPoints":0,"isSecureContext":true}
getByRole button "Add via photo" count = 1  -> resolves to #desk
setInputFiles on display:none input -> OK

=== Pixel 5 ===         {"coarse":true,"fine":false,"hover":false,"maxTouchPoints":1,"isSecureContext":true}
getByRole button "Add via photo" count = 1  -> resolves to #mob
setInputFiles on display:none input -> OK
```

Three things that settles:

- **`devices["Pixel 5"]` does flip `pointer: coarse`.** The mobile branch renders and the desktop
  branch leaves the accessibility tree, so `getByRole` resolves to exactly **one** element — no
  strict-mode violation, no `.first()` needed. (Descriptor: `viewport 393×727`, `screen 393×851`,
  `deviceScaleFactor 2.75`, `isMobile: true`, `hasTouch: true`, `defaultBrowserType: chromium`.)
  `src/layouts/Layout.astro:17` carries `<meta name="viewport" content="width=device-width">`, so
  the app really does lay out at 393 CSS px.
- **`setInputFiles` runs no actionability checks**, so a `display:none` input is fine. Confirmed at
  source level too — Playwright's `_setInputFiles` "does not call `checkElementStates` or any
  actionability checks (visible, enabled, editable, stable)"; it only verifies the node is an
  `INPUT` (Context7 `/microsoft/playwright`, `packages/playwright-core/src/server/dom.ts`, checked
  2026-07-27).
- **`http://localhost:4321` is a secure context**, so `navigator.mediaDevices` is defined and
  `CameraCapture`'s insecure-origin guard (`CameraCapture.tsx:60-65`) does not fire.

**Is the capture path gated behind anything desktop-only? No — the gating runs the other way.** The
*camera* is gated to coarse pointers. There is no desktop-only step anywhere in the journey. That is
the risk's own question ("a desktop step sneaks in") answered in the negative at rest; the spec's job
is to keep it that way.

**One layout branch to know about.** `src/pages/library/index.astro` mounts `PhotoCapture` twice —
`:152` (populated header) and `:188` (empty-state card) — but they are **mutually exclusive**, both
keyed on `isEmpty = total === 0 && !loadError && !isFiltered` (`:114`). At most one island mounts.
The locator is identical either way; only the ancestry differs.

### Q2 — The client-side journey after capture

**One shared pipeline for both paths** — `PhotoCapture.tsx:116-162`:

```ts
async function submitBlob(blob: Blob) {
  if (inFlightRef.current) { return; }          // synchronous double-persist latch
  inFlightRef.current = true;
  setError(null); setNotice(null); setPending(true);
  const controller = new AbortController();
  const timeout = setTimeout(() => { controller.abort(); }, 30000);
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
    if (data.status === "identified") { openDialog(data.entry); }
    else { setNotice(UNSURE_NOTICE); openDialog(undefined); }
  } catch (err) { … }
  finally { clearTimeout(timeout); setPending(false); inFlightRef.current = false; }
}
```

**The request**: exactly one — `POST /api/identify`, multipart, fields `photo` (JPEG blob named
`photo.jpg`) and `persist="true"`. Nothing else fires. `waitForResponse("**/api/identify")` is a
clean, non-time-based wait, and its JSON body carries the persisted `entry` — which is the test's
handle on a row whose title it did not choose. That matters for §Q3.

**While identify runs**: a full-screen blocking overlay, `PhotoCapture.tsx:170-179`:

```tsx
{pending && (
  <div className="fixed inset-0 z-50 …" role="status" aria-live="polite">
    <Loader2 className="size-12 animate-spin text-white" />
    <p className="text-base font-medium text-white">Identifying your game…</p>
  </div>
)}
```

→ `getByRole("status")` / text `"Identifying your game…"`. The button label also flips to
`"Identifying…"` and both branches go `disabled`.

**The three outcomes, with the DOM each produces:**

| Outcome | Route response | What the user sees |
|---|---|---|
| `identified` (row already saved) | 200, `{status:"identified", …, entry}` (`identify.ts:184-193`) | `GameDialog` opens **in edit mode**, seeded from `entry` → `getByRole("dialog", {name:"Edit game"})` |
| `unsure` (abstain) | 200, `{status:"unsure", confidence}` (`identify.ts:150-152`) | `GameDialog` opens in **add mode** → `getByRole("dialog", {name:"Add a game"})` + the notice `<p>` |
| HTTP error | 401/400/500/**502** | No dialog. Inline `<p className="text-destructive …">{error}</p>` (`:245`) |

The dialog name is the discriminant — `GameDialog.tsx:366`,
`<DialogTitle>{isEdit ? "Edit game" : "Add a game"}</DialogTitle>` with
`isEdit = activeEntry !== undefined` (`:132-134`). **That single assertion separates "auto-saved"
from "abstained" without touching metadata**, which is exactly the risk-appropriate altitude.

The abstain notice, `GameDialog.tsx:375-377`:

```tsx
{!isEdit && notice && (
  <p className="rounded-md bg-amber-500/15 px-3 py-2 text-sm text-amber-200">{notice}</p>
)}
```

It is a bare `<p>` — no role, not wired into `aria-describedby` — so the only locator is text. The
literal (`PhotoCapture.tsx:24`) uses **U+2019 (’) and an em dash**:
`"We couldn’t identify that photo — add the game manually instead."` An ASCII `couldn't` will not
match; use `/couldn’t identify that photo/` copied from source.

**The assertion that carries the risk — and the seam that makes it possible.**
`PhotoCapture.tsx:254-262`:

```tsx
onOpenChange={(next) => {
  setDialogOpen(next);
  // A photo-identified entry is persisted server-side before the dialog opens, so a plain
  // close (no edit) still added a row — refresh the list to show it.
  if (!next && reviewEntry) {
    window.location.assign("/library");
  }
}}
```

**A photo-saved entry is invisible in the list until that navigation happens.** The library table is
100% SSR (`index.astro:54-70`) and nothing client-side re-fetches it — `entrySync.ts` is a
row-scoped `play_status` pub/sub between two islands of an *already-rendered* row
(`entrySync.ts:5-14`), not a list refresher. **This is Risk #3's "never lands visibly" failure mode
in one line of code**: delete that `window.location.assign`, and the row is saved but the user never
sees it. Nothing below the browser can observe that. It is the strongest single assertion available
to this phase.

The row itself — `index.astro:237-265`, a plain `<tr>` with **no id, no `data-*`, no `aria-label`**:

```jsx
<tr class="border-b border-white/5 last:border-0">
  <td class="px-4 py-3">
    <span class="font-medium text-white">{entry.title}</span>
    {noMeta && (<span class="…">{noMeta}</span>)}
  </td>
  <td class="px-4 py-3 text-emerald-100/80">{entry.platform}</td>
  …
```

So `getByRole("row", {name: new RegExp(title)})` matching on name-from-content is the only reliable
form (as the seed already does, `seed.spec.ts:33`), and `metadataLabel` (`index.astro:123-125`)
injects the literal **`"No metadata"`** badge whenever `metadata_status !== "matched"` — directly
observable, and the expected state for any never-matching title. **There are zero `data-testid`
attributes anywhere in `src/`** (verified by repo-wide grep), so role+text is the whole toolkit.

**The list has no mobile variant** — one `<table>`, no breakpoint-hidden regions, only
`overflow-x-auto` on the wrapper (`index.astro:223`). `getByRole("row")`/`getByRole("cell")` work
identically at 393 px.

### Q3 — Determinism: what levers actually exist

**The server-side call chain, in order** (all from the Worker, so `page.route()` is blind to all of
it — `e2e/RULES.md:49-52`):

1. **OpenRouter vision** — `vision.ts:18-19`, `:80-103`:
   ```ts
   const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
   const VISION_MODEL = "google/gemini-2.5-flash";
   export const CONFIDENCE_THRESHOLD = 0.6;
   …
   if (!OPENROUTER_API_KEY) { throw new Error("Missing OPENROUTER_API_KEY — …"); }
   const response = await fetch(OPENROUTER_ENDPOINT, { … });
   ```
   The endpoint is a **hardcoded const with no env override** — there is no way to point it at a
   local mock.
2. **Twitch app-token mint** — only on a KV cache miss (`igdb-token-cache.ts:53-83`).
3. **IGDB `games` search**, then **IGDB `game_time_to_beats`** — only on a confident match
   (`igdb.ts:444-499`, `:522-527`).

**Determinism seams: none exist.** I had an agent search all of `src/` for `import.meta.env.DEV`,
`MOCK|STUB|FIXTURE|FAKE|E2E_|PLAYWRIGHT`, and every use of the provider env vars. Findings:

- The only `import.meta.env.DEV` in `src/` is `src/pages/auth/confirm-email.astro:4` — unrelated.
- `src/lib/config-status.ts:11-19` checks **Supabase only** and feeds the layout banner. It is not a
  provider-degradation path.
- All mocking machinery is Vitest-scoped and unreachable from a running server: `vitest.config.ts:19`
  aliases `astro:env/server` → `test/stubs/astro-env-server.ts`, `test/setup/no-network.ts` denies
  unrouted fetch, `identify.test.ts:25` mocks `cloudflare:workers`. None of it applies to
  `npm run dev`.

**And Playwright's `webServer.env` cannot override the Worker's secrets.** Verified by reading
wrangler's source, `node_modules/wrangler/wrangler-dist/cli.js:297461-297480`:

```js
if (!envFiles?.length) {
  const devVarsPath = path3.resolve(configDir, ".dev.vars");
  const loaded = loadDotDevDotVars(devVarsPath, env6);
  if (loaded !== void 0) { … loadedSecrets = loaded.parsed; }
}
if (loadedSecrets === void 0 && getCloudflareLoadDevVarsFromDotEnv()) {
  … loadedSecrets = loadDotEnv(resolvedEnvFilePaths, { includeProcessEnv: … });
}
```

`.dev.vars` wins, and `process.env` is consulted **only when `.dev.vars` is absent**. This repo has
`.dev.vars` (keys: `SUPABASE_URL`, `SUPABASE_KEY`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`,
`OPENROUTER_API_KEY`). Astro's env layer compounds it: secrets are bound once at worker init
(`astro/dist/env/vite-plugin-env.js:143-148`), so even a `.dev.vars` edit needs a dev-server restart
— and `playwright.config.ts:69` sets `reuseExistingServer: !IS_CI`, so a locally-running server would
silently keep the old values.

**What env-var absence actually does** (both measured against source, not assumed):

| Change | Effect | Deterministic? |
|---|---|---|
| Blank `OPENROUTER_API_KEY` | `vision.ts:80` throws → caught at `identify.ts:143-147` → **HTTP 502**, body `{"error":"Missing OPENROUTER_API_KEY — …"}` rendered inline. IGDB never reached, nothing saved. | Yes — but it tests the error branch, not the risk |
| Blank `TWITCH_CLIENT_ID/SECRET` | `createIgdbClient` throws, **swallowed** at `identify.ts:157-161` → `grounding = null` → row still saved with `igdb_id: null, metadata_status: "no_match"` | Yes for the *grounding* half; vision stays live |

**So: the only fully deterministic identify outcomes obtainable today are the failure/abstain ones.
There is no existing way to get a deterministic `identified` result.**

**Four options for the plan. Each has a real cost; none is free.**

**(A) Real provider call + a deterministic fixture image, assert journey invariants only.**
The test never predicts *what* the model says. It harvests the persisted row from the response:
```ts
const [res] = await Promise.all([ page.waitForResponse("**/api/identify"), captureAction() ]);
const body = await res.json();   // { status, entry: { id, title, … } }
```
and asserts the journey around it — dialog opened in edit mode, close navigates, `getByRole("row",
{name: new RegExp(escapeRegExp(body.entry.title))})` is visible after the SSR reload, then deletes
that row. Deterministic *about the journey* while agnostic *about the identification* — which is
precisely the split §2 asks for (grounding correctness belongs to §6.2).
*Costs*: a live OpenRouter call per run (~fractions of a cent, but real); requires
`OPENROUTER_API_KEY` **and outbound network in CI** when Phase 5 wires the e2e gate; and the
`identified`-vs-`unsure` branch is model-dependent, so the spec is only as stable as the fixture's
legibility. A branch-tolerant spec (assert "a dialog opened, and if identified the row is visible")
weakens the assertion to near-decorative — so this option really means *betting on the fixture*.

**(B) Add a minimal test-only seam in `vision.ts`.** An `astro:env/server` var (declared in
`astro.config.mjs`) that, when set, short-circuits `identifyGameFromPhoto` to a canned
`{status:"identified", title, platform, confidence}` — pointed at a timestamped title that can never
match IGDB, exactly reproducing the seed's evasion (`seed.spec.ts:23-27`).
*Benefits*: fully deterministic, zero cost, zero network, CI-ready, and it still exercises the whole
browser journey plus the real grounding→`no_match`→insert→SSR path.
*Costs*: **a production code change in a test-writing phase** — which §7 and every prior phase note
treat as the exception, not the rule (Phase 2 made exactly one such edit and flagged it). It also
means the e2e never calls the real vision provider, so "the provider integration works in the real
runtime" moves to manual/pre-prod smoke. And it is a live seam in shipped code that must be
key-guarded so it cannot be flipped in production.

**(C) Blank `TWITCH_CLIENT_*` only.** Removes IGDB from the path deterministically; vision stays
live. Halves the nondeterminism, solves none of the important half. Also requires editing `.dev.vars`
(see above) — not per-run switchable.

**(D) Drive the abstain path deliberately** (a fixture image guaranteed unidentifiable, or a blank
key). Cheap and stable, and it does cover a real US-01 acceptance criterion (`prd.md:58` — abstain
routes to manual entry). But it does **not** cover the risk as written, which is about the entry
*landing visibly*.

**Recommendation for the plan to weigh, not a decision**: (B) is the only option that makes the
e2e gate CI-viable, deterministic, and free — the three properties Phase 5 will need. (A) is the only
option that keeps production code untouched. A defensible middle is **(B) as the committed spec plus
(A) kept as a manually-run, `test.skip`-free opt-in** — except `e2e/RULES.md:61-62` forbids
`test.skip`, so an opt-in variant would need a grep-excluded filename or a separate npm script rather
than a skipped test.

**The camera-feed lever, measured.** `--use-file-for-fake-video-capture` accepts a Y4M and reproduces
it exactly:

```
=== fake-device + fake-ui + grant ===                  {"ok":true,"w":640,"h":480,"centerPixel":[74,255,22],"jpegBytes":8200}
=== fake-device + fake-ui + FILE FEED (red y4m) ===    {"ok":true,"w":320,"h":240,"centerPixel":[254,0,0],"jpegBytes":1212}
=== fake-device + fake-ui + FILE FEED, run twice ===   {"ok":true,"w":320,"h":240,"centerPixel":[254,0,0],"jpegBytes":1212}
```

The encoded colour comes back exactly (254,0,0 for a pure-red Y4M) and the JPEG is byte-identical
across runs. Two practical notes: the stream resolution is the **Y4M's** resolution, not the
requested one — so encode the fixture at ~1024 px long edge to match what F-03 measured accuracy at
(`downscale.ts:17`, `DEFAULT_MAX_EDGE = 1024`); and the *default* fake device is an animated
green/rolling pattern, so a spec that omits the file feed is feeding the vision model noise.

### Q4 — What "mobile" honestly means here

**Emulation-only, and the plan must say so.** `devices["Pixel 5"]` is a Chromium context with a
Pixel 5 UA string, a 393×727 viewport, `deviceScaleFactor: 2.75`, `isMobile: true`, `hasTouch: true`.
That is enough to genuinely exercise:

- the `@media (pointer: coarse)` split — **measured true**, so the mobile affordance really is the
  one under test;
- mobile layout and locator resolution at 393 px;
- the real `getUserMedia` → `<video>` → canvas → JPEG pipeline (`CameraCapture.tsx:105-134`) against
  a fake device;
- the real `createImageBitmap({imageOrientation:"from-image"})` → canvas → JPEG downscale on the
  gallery path (`downscale.ts:52-86`) — **which has no test anywhere**;
- the real fetch, the real Worker, the real Supabase insert, the real SSR re-render.

**What it cannot honestly exercise, and what a green spec must not be read as covering:**

1. **A real mobile camera.** Chromium's desktop media stack with a synthetic device. No permission
   prompt, no orientation, no EXIF, no real sensor.
2. **A real mobile browser.** `devices["Pixel 5"]` is Chromium. `prd.md:173` demands *"the latest two
   major versions of the four mainstream browsers — Chrome, Firefox, Safari, Edge — across both
   desktop and mobile form factors. The mobile path explicitly includes the camera-capture flow
   described in FR-004."* That is a 16-cell matrix; `playwright.config.ts` runs **one cell**.
   Playwright could add `firefox` and `webkit` projects (and WebKit is the closest available proxy
   for mobile Safari), but "latest two major versions" is outside Playwright's model entirely.
   **Any Phase-4 claim to cover "the browser NFR" over-claims by roughly 15/16.**
3. **The historical failure this risk descends from.** From
   `context/archive/2026-06-17-photo-to-library/plan.md:47` — the struck-through non-goal:
   > *"**OBSOLETE (Phase 3).** Manual testing showed the `<input capture="environment">` camera path
   > hands off to the OS camera app, which backgrounds/evicts the page and drops the in-flight
   > `/api/identify` connection ~80% of the time on mobile → silent failure."*

   No Playwright emulation reproduces OS app-switching, page eviction, or a real mobile uplink. **If
   `<input capture>` were reintroduced tomorrow, an emulated Pixel 5 spec would pass green.** This is
   the sharpest honesty constraint on the phase and belongs in the spec's header comment, not just
   in this document.
4. **The 10 s p95 latency NFR** (`prd.md:170`). The only measurement on record —
   `context/archive/2026-06-11-photo-identification-spike/results.md:49-52`, p50 2.56 s / p95 3.25 s
   — explicitly *"excludes the real phone→Worker mobile uplink."* The NFR's actual subject has never
   been measured, and localhost Playwright will not measure it either.

**Honest scope of one spec**, stated as the header should state it: *"this proves the app's own
mobile wiring — the coarse-pointer affordance, the in-page camera pipeline, the identify round-trip,
the auto-save, and the navigation that makes the row visible — on emulated mobile Chromium. It does
not prove mobile Safari, a real camera, OS-level page eviction, or the mobile latency NFR; those stay
manual (`plan.md:230-237`) or move to pre-prod smoke."*

**Two mechanical gotchas the plan should carry:**

- **Launch args are per-file-able.** `launchOptions` is a `TestOptions` field, so
  `test.use({ ...devices["Pixel 5"], launchOptions: { args: [...] } })` is valid (Context7
  `/microsoft/playwright`, `class-testoptions.md`, checked 2026-07-27). Overriding `launchOptions`
  forces a fresh browser for that worker — acceptable for one spec, and consistent with
  `playwright.config.ts:59-61`'s "don't make the rest of the suite pay" rationale.
- **`hover: false` and `maxTouchPoints: 1`** under Pixel 5. The Radix `DropdownMenu` opens on
  pointerdown; Playwright's `.click()` on a `hasTouch` context still synthesizes mouse events. This
  usually works, but it is the most likely source of a first-run surprise — verify before assuming,
  and reach for `.tap()` only if `.click()` misbehaves.

### Q5 — Where existing coverage ends

**§6.2's integration suite already owns the seam, thoroughly.** Both auto-save faces, the abstain
faces, normalization-before-grounding, the base64 payload, the 502 no-leak path, and the persist
payload mapping are all asserted:

| Already covered (do **not** re-assert) | Where |
|---|---|
| low-confidence vision → `unsure`, Supabase never constructed | `src/pages/api/identify.test.ts:118` |
| unparseable vision envelope → `unsure`, no save | `identify.test.ts:130` |
| confident + IGDB miss + persist → **saved** with `igdb_id:null, metadata_status:"no_match"` | `identify.test.ts:140` |
| confident + IGDB match + persist → `metadataStatus:"matched"` + base id | `identify.test.ts:162` |
| harness path (persist off) folds confident+no_match → `unsure` | `identify.test.ts:182` |
| normalization runs **before** grounding; normalized values reach IGDB *and* the save | `identify.test.ts:201` |
| photo → OpenRouter as a base64 data URL | `identify.test.ts:230` |
| 401 / missing photo / empty / >10 MB / exactly 10 MB / wrong mime | `identify.test.ts:247-284` |
| non-2xx OpenRouter → status-only 502, no upstream body leak | `identify.test.ts:286` |
| grounding→columns mapping incl. `no_match` and null-grounding | `src/lib/services/library.test.ts:106-162` |
| edition collapse, platform-agreement, four `no_match` abstain faces, every threshold boundary | `src/lib/services/igdb.integration.test.ts:60-323` |
| `computeTargetDimensions` arithmetic (7 cases) | `src/lib/image/downscale.test.ts:5-40` |
| manual-add journey through the real stack | `e2e/seed.spec.ts:30` |

**What no layer covers — the whole of the browser half:**

- **`PhotoCapture` has zero tests.** `submitBlob` (`:116-162`), the `inFlightRef` latch (`:118-121`),
  the 30 s abort and its "may already be saved" copy (`:128-131,152-154`), the `!response.ok` inline
  error (`:138-142`), the `identified` vs `unsure` branch (`:145-150`), the `dialogKey` remount
  (`:60-61,71`), the `role="status"` overlay (`:170-179`), and the post-close
  `window.location.assign("/library")` (`:259-261`).
- **`CameraCapture` has zero tests** — `getUserMedia`, the `NotAllowedError`/`NotFoundError` message
  mapping, track cleanup, the canvas export.
- **`downscaleImage` itself has no test** — only its arithmetic helper does; `downscale.ts:23-24`
  says so outright.
- **The pointer-type split is untested at every layer**, and there is no mobile-viewport test
  anywhere in the repo.
- **No React component tests exist and none can.** `vitest.config.ts:24` `environment: "node"`;
  `:25` `include: ["src/**/*.test.ts"]` (`.tsx` never collected); no `jsdom` / `happy-dom` /
  `@testing-library/*` in `package.json:50-75` or `node_modules`. All 11 test files under `src/` are
  `.ts`.
- **A latent contract gap worth one assertion.** The route returns `entry` on the persist path
  (`identify.ts:192`, typed `types.ts:233`) and the island reads `data.entry`
  (`PhotoCapture.tsx:146`), but **no test asserts `entry` is present** — `identify.test.ts:157,173`
  use `toMatchObject` over `{status, igdbId, metadataStatus}` only. Dropping `entry` from the route
  keeps every existing test green while silently degrading the island to add-mode. The e2e's
  "dialog opens as **Edit game**" assertion closes exactly this, at the right altitude.

**Cheapest-layer check: confirmed.** Nothing above can be moved down. §6.4's route layer cannot see a
React island; §6.7's pgTAP cannot see a browser; the unit layer cannot import a `.tsx` at all.

---

## Verification of §2's Risk #3 response guidance

Following §1 principle #3 — research is ground truth where it disagrees with the plan.

| §2 cell | Verdict |
|---|---|
| *"Likely cheapest layer: e2e (Playwright) — no cheaper layer covers the browser + camera journey"* | **Confirmed, and stronger than stated.** No cheaper layer *exists* for any React component in this repo. |
| *"Anti-pattern: e2e-ing what an integration test already covers (grounding/seam logic)"* | **Confirmed and actionable.** §6.2 covers the seam at 37 assertions. The e2e must assert **journey shape** (dialog mode, row visible after SSR reload), never a title, `igdb_id`, or `metadata_status` value. |
| *"What would prove protection: capture → identify → auto-save → entry-visible completes with no required desktop step"* | **Achievable, with one correction.** "Entry-visible" is not automatic — it depends on `window.location.assign("/library")` at `PhotoCapture.tsx:259-261`. That line **is** the risk, and asserting the row after the dialog closes is the assertion that carries it. |
| *"Context to ground: what the abstain path shows the user"* | **Grounded**, but it is a text-only locator on an unroled `<p>` with typographic punctuation (`GameDialog.tsx:375-377`, `PhotoCapture.tsx:24`). And on the *persist* path a confident-but-IGDB-missing read **still saves** (`identify.ts:184-193`) — only a low-confidence vision read abstains. Budget says one test per risk, so the abstain branch is likely a second spec or out of scope; say which. |
| *"Must challenge: 'works on desktop Chrome' is not 'works on mobile Safari camera'"* | **Unsatisfiable as written.** A Chromium-only harness with a Chromium Pixel 5 descriptor cannot run mobile Safari. Either add a `webkit` project (WebKit ≈ Safari's engine, still not iOS Safari) or rewrite the cell to what the harness can actually keep. Leaving it as-is means a green spec reads as a promise the harness structurally cannot make. |
| *(unstated, but the more important challenge)* | **"the emulated journey passes" is not "the failure that produced this risk cannot recur."** The ~80% eviction failure (`plan.md:47`) is invisible to every emulator. This should replace or join the mobile-Safari line. |

---

## Evidence audit — where the plan's citations don't hold

- **"interview Q4" does not exist on disk.** `shape-notes.md` has no interview section and no
  Q-numbered content (its Phase-2 record is a `gray_areas_resolved` YAML list, `:18-36`). A repo-wide
  grep for `Q4` returns only test-plan.md:53, this change's change.md:13, and two Stryker sandbox
  copies — all downstream of the claim. The `/10x-test-plan` interview was conversational and never
  persisted. Same for Q1/Q2/Q3/Q5 in Risks #1, #2 and §7. **Unverifiable, not false** — but it is the
  *only* likelihood evidence for Risk #3; PRD §NFR and US-01 establish impact, and a requirement
  never becomes *likely to fail* by being written down.
  **Two real, dated, quotable replacements exist and say the same thing:**
  - `context/foundation/roadmap.md:150` — *"Does the in-browser mobile camera-capture path work
    end-to-end on the four mainstream browsers (NFR), with no required desktop step? — Owner: team."*
  - `context/archive/2026-06-17-photo-to-library/change.md:20` — *"In-browser mobile camera-capture
    must work end-to-end on the four mainstream browsers (NFR), no required desktop step — validate
    during planning."*

  Recommend swapping the Source cell in §2 Risk #3.
- **The browser NFR is over-claimed** — see §Q4 item 2. §4's e2e row and §2's Risk #3 cell both read
  as if the harness delivers "a real mobile browser"; `change.md:17` says so literally. It will not.
- **"Chromium only" is an undocumented decision.** `playwright.config.ts:50-62` declares one project
  with no rationale; `e2e/RULES.md` never mentions browsers; `test-plan.md:118` records it as a
  status. It directly contradicts a must-have NFR and deserves an explicit, written decision in this
  phase (accept the gap, or add `webkit`).
  By contrast, **"mobile as per-spec, not a project" *is* documented** and the reason is sound —
  `playwright.config.ts:59-61`: *"the rest of the suite doesn't pay for a second full run."*
- **Minor citation slip, twice.** The abstain→manual-entry contract is attributed to FR-006 (§2 Risk
  #2 and `change.md:17`). FR-006 (`prd.md:126`) mandates auto-save only; the manual-entry fallback is
  **US-01 AC `prd.md:58`** and FR-007 (`prd.md:130`). Cite those.
- **A known open bug intersects the spec's cleanup.**
  `context/archive/2026-06-17-photo-to-library/reviews/impl-review.md` F3, **SKIPPED**: on the 30 s
  abort the server may already have inserted, so a retry duplicates. F3 is Risk #3's failure shape
  seen from the other side — *the entry lands but the user is not shown it.* A spec's cleanup step
  should not assume exactly one row was created.

---

## Code References

- `src/components/library/PhotoCapture.tsx:197-240` — the `@media (pointer:coarse)` capture split; both branches always in the DOM
- `src/components/library/PhotoCapture.tsx:189-195` — the hidden gallery `<input type="file">`, no label/id/role
- `src/components/library/PhotoCapture.tsx:116-162` — `submitBlob`: the single `POST /api/identify` with `persist=true`, the 30 s abort, the three-way branch
- `src/components/library/PhotoCapture.tsx:170-179` — the `role="status"` "Identifying your game…" overlay
- `src/components/library/PhotoCapture.tsx:254-262` — `window.location.assign("/library")` on close: the only thing that makes a photo-saved row visible
- `src/components/library/PhotoCapture.tsx:24` — `UNSURE_NOTICE`, typographic ’ and —
- `src/components/library/CameraCapture.tsx:55-103` — `getUserMedia` mount effect, insecure-origin guard, `NotAllowedError`/`NotFoundError` mapping
- `src/components/library/CameraCapture.tsx:105-134,141-147` — canvas capture; the `role="dialog"` `aria-label="Take a photo of the game box"` with `Cancel`/`Capture`
- `src/components/library/GameDialog.tsx:366` — `Edit game` vs `Add a game`: the identified/abstain discriminant
- `src/components/library/GameDialog.tsx:375-377` — the unroled `notice` `<p>`
- `src/pages/library/index.astro:114,149-161,179-198` — `isEmpty` mutually-exclusive PhotoCapture mount points
- `src/pages/library/index.astro:220-268` — the SSR table; `:123-125` the `"No metadata"` badge
- `src/components/library/entrySync.ts:5-14` — row-scoped pub/sub, **not** a list refresher
- `src/pages/api/identify.ts:117-136` — request contract; `:150-152` abstain; `:184-193` persist+identified; `:196-202` the harness-only fold
- `src/lib/services/vision.ts:18-19,80-103` — hardcoded endpoint, model, threshold, the `OPENROUTER_API_KEY` throw
- `src/lib/services/library.ts:92-148` — `metadataFromGrounding` + the insert
- `src/lib/image/downscale.ts:17,52-86` — `DEFAULT_MAX_EDGE = 1024`; the untested `downscaleImage`
- `src/layouts/Layout.astro:17` — `<meta name="viewport" content="width=device-width">`
- `playwright.config.ts:50-73` — one `chromium` project, the per-spec Pixel 5 note, `reuseExistingServer: !IS_CI`
- `vitest.config.ts:24-25` — `environment: "node"`, `include: ["src/**/*.test.ts"]`
- `node_modules/wrangler/wrangler-dist/cli.js:297461-297480` — `.dev.vars` beats `process.env`

## Architecture Insights

- **The visibility of a photo-saved entry is a client-side navigation, not a server render.** The row
  exists the instant `/api/identify` returns; whether the *user* ever sees it rests on one
  `onOpenChange` callback. That asymmetry is the architectural shape of Risk #3 and explains why no
  server-side layer can catch it.
- **The persist flag makes `/api/identify` two different routes.** A confident vision read that IGDB
  misses is a **saved row** with `persist=true` and an **abstain** without it (`identify.ts:184-202`).
  The UI only ever uses the first. A spec reasoning from the harness path would draw the wrong branch.
- **Accessibility attributes are the only test surface, and they are uneven.** Zero `data-testid` in
  `src/`; `Title` is properly labelled but the platform combobox is not (`<Label htmlFor="game-platform">`
  points at a non-existent id — `seed.spec.ts:41-43` documents the workaround); the abstain notice has
  no role. Where a spec is forced into `page.locator('input[type="file"]')`, that is a gap in the app's
  accessibility, not a rule violation to hide.
- **Client-side downscale is architecturally mandatory** (workerd has no `sharp` —
  `identify.ts:33-36`), so `createImageBitmap` + canvas is on the critical path of every photo. It has
  no test at any layer, and only a browser can run it.

## Historical Context (from prior changes)

- `context/archive/2026-06-17-photo-to-library/plan.md:47` — the struck-through non-goal recording the
  `<input capture>` → `getUserMedia` reversal and the ~80% eviction failure rate; also notes
  `getUserMedia` needs a secure context and that mobile testing was done via an HTTPS tunnel.
- `context/archive/2026-06-17-photo-to-library/plan.md:43,45` — no photo storage (nothing persisted to
  assert on); *"no harness re-run as an acceptance gate — acceptance is manual E2E."* S-03 shipped on a
  **manual** browser matrix (`plan.md:230-237,305-306`), never an automated one.
- `context/archive/2026-06-17-photo-to-library/reviews/impl-review.md` F3 — the SKIPPED abort-but-saved
  duplication seam. F1 (rapid-capture double persist) *was* fixed with `inFlightRef`.
- `context/archive/2026-06-19-fix-platform-combobox-clipping/plan.md:36` and
  `2026-06-19-unify-visual-theme/plan.md:36` — both explicitly declined to stand up a component or
  Playwright harness, which is why Phase 4 inherits a bare harness and no precedent.
- `context/archive/2026-06-11-photo-identification-spike/results.md:49-52` — p50 2.56 s / p95 3.25 s,
  *excluding* the real mobile uplink.
- `context/foundation/lessons.md` — two entries, neither about mobile, camera, browsers, or e2e.
  Phase 4 is a plausible source of the third.

## Related Research

- `context/changes/testing-grounding-identify-seam/` — Phase 1; owns the identify seam this phase must
  not re-test. Its "What We're NOT Doing" lists three recorded-not-fixed code gaps (empty-title
  pass-through, no ambiguity disambiguation, no redaction on the grounding-error path).
- `context/changes/testing-route-contracts-isolation/` — Phase 3; the precedent for *"§2's response
  guidance was inverted and research, not the plan, was the ground truth."* It also flagged the
  fractional-`length_hours` un-editable-row bug as *"only a browser can verify the fix — Phase 4."*
  That is a **separate risk from #3** and, on the one-test-per-risk budget, out of scope here — but it
  is now the second item waiting on this layer, and the plan should say whether it takes it.

## Open Questions

1. **Which determinism option (A/B/C/D in §Q3)?** This is the plan's central decision. Option (B) is
   a production code change in a test-writing phase — a deliberate exception that needs a written
   rationale, a key-guard so it cannot fire in production, and a §7 note.
2. **Does Phase 5's CI e2e gate get outbound network and an `OPENROUTER_API_KEY`?** Option (A) makes
   that mandatory; (B) makes it unnecessary. Deciding (A) here silently sets Phase 5's requirements.
3. **`webkit` project: add or explicitly decline?** Declining is defensible; leaving §2's "mobile
   Safari" challenge in place while declining is not.
4. **Camera path or gallery path — or both in one spec?** The camera path is the one the risk names
   and the one the pointer-split gates; the gallery path is the one that exercises the untested
   `downscaleImage`. One-test-per-risk argues for the camera path plus a `setInputFiles` gallery step
   only if it costs nothing.
5. **Y4M fixture provenance.** A committed `.y4m` at ~1024 px is a few hundred KB of binary in the
   repo. Generating it at test time from a committed JPEG needs an image decoder Node doesn't have
   (Playwright ships an `ffmpeg` binary, but depending on it is fragile). Under option (B) the fixture
   content stops mattering and a tiny synthetic Y4M suffices — another point in (B)'s favour.
6. **Does `.click()` drive the Radix dropdown under `hasTouch`?** Expected yes; verify on first run
   before reaching for `.tap()`.
7. **Cleanup under F3.** If the abort-but-saved seam fires, more than one row may exist. Should the
   spec's cleanup be tolerant, or should it assert exactly one row was created (making F3 visible)?
