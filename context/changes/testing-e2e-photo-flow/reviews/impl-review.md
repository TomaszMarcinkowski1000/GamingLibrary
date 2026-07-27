<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Rollout Phase 4 — End-to-end photo flow (Risk #3)

- **Plan**: `context/changes/testing-e2e-photo-flow/plan.md`
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-07-27
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 6 observations
- **Triage**: complete (2026-07-27) — 8 of 8 fixed, 0 skipped. F3 took Fix B (defer the CI change,
  record the raised stakes); the other seven took their single offered fix. Full suite re-run green
  afterwards; see "Re-run after triage" below.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → PASS after triage |
| Architecture | PASS |
| Pattern Consistency | WARNING → PASS after triage |
| Success Criteria | PASS |

## Success criteria — re-run at review time

| Command | Result |
|---|---|
| `npm run typecheck` | PASS — 90 files, 0 errors, 0 warnings |
| `npm run lint` | PASS — clean (only pre-existing `astro-eslint-parser` notices) |
| `npm test` | PASS — 12 files / 235 tests |
| `npx vitest run src/lib/services/vision.test.ts` | PASS — 7 tests |
| `npm run test:e2e` | PASS — 4/4 (setup + seed + both new specs), 20.5s |
| `git status --porcelain` | clean — no falsification break left in the tree |

### Re-run after triage (2026-07-27)

| Command | Result |
|---|---|
| `npm run lint` | PASS — clean |
| `npx astro check` | PASS — 0 errors, 0 warnings, 5 pre-existing hints |
| `npm test` | PASS — 12 files / **238 tests** (F8 added 3 guard cases) |
| `npx vitest run src/lib/services/vision.test.ts` | PASS — **10 tests** |
| `npm run test:e2e` | PASS — 4/4, 18.8s |
| `node scripts/make-e2e-fixtures.mjs` | PASS — exit 0, `1600x1200`, fixtures byte-identical |
| local `library_entries` where `title like 'E2E%'` | 0 rows — including after the deliberate red run |

One flake seen and not reproduced: on the first full `test:e2e` of the session (cold dev server,
40.6s) `seed.spec.ts` timed out waiting for the "Add a game" dialog. It passed alone in 2.6s and on
every subsequent full run. `seed.spec.ts` reaches its trigger without the `clickUntilRevealed`
guard, so it is the one spec still exposed to the hydration race the guard exists for. Not touched
here — outside the triaged findings — but worth a look before the e2e CI gate lands, where a cold
server is the normal case rather than the exception.

Manual criteria carry in-file evidence: the falsification tables in both spec headers are dated
2026-07-27 with per-break observed outcomes; the `.click()`-vs-`.tap()` ruling is recorded at
`e2e/photo-capture-mobile.spec.ts:63-66`; the `filechooser`-vs-fallback ruling at
`e2e/photo-gallery-desktop.spec.ts:76-79`.

## Notes on deviations (all documented in-file, none adverse)

- `waitForURL("**/library")` dropped in favour of awaiting the row itself — the plan's journey listed
  it, but it is a no-op against the URL already loaded. Assertion strength unchanged.
- The desktop "no `Take photo` menuitem" check was replaced by `not.toHaveAttribute("aria-haspopup")`
  plus a `getByRole("menu")` count — the literal check would be vacuous, since Radix renders menu
  content only while open.
- `clickUntilRevealed` / `pickFileUntilChooserOpens` are unplanned additions handling an island
  hydration race. They wait on state, not on time, and are backported into `e2e/RULES.md`.
- `.gitattributes` gains `*.y4m binary` — unplanned but necessary: the repo sets `* text=auto`, and a
  NUL-free Y4M would be CRLF-mangled on a Windows checkout.
- `change.md` reads `status: implemented` where the plan said `complete`; `implemented` is the repo's
  actual pre-archive vocabulary, so the plan was the one out of step.

## Findings

### F1 — `.dev.vars.example` never gained the seam key

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `.dev.vars.example:1-4`
- **Detail**: The change's own documentation makes `.dev.vars` the file that *decides* the server's
  value — `.env.example:24-25` and `e2e/RULES.md:106-110` both state that wrangler reads `.dev.vars`
  first and only consults `.env`/`process.env` when it is absent. `.env.example` was updated with a
  thorough 16-line block; the tracked template for the load-bearing file was not. It still lists only
  `SUPABASE_URL/KEY` and `TWITCH_CLIENT_ID/SECRET`, and is missing `OPENROUTER_API_KEY` too
  (pre-existing). A fresh checkout that follows `.dev.vars.example` gets a disarmed server and the
  specs fail on the `expect(response.status()).toBe(200)` guard. The plan's Phase 1 item 6 named only
  `.env.example`, so this is a gap in the plan as much as in the implementation.
- **Fix**: Add `OPENROUTER_API_KEY=` and `E2E_VISION_STUB_KEY=` to `.dev.vars.example`.
- **Decision**: FIXED — both keys added, with the wrangler-precedence and never-in-production
  notes carried over from `.env.example`.

### F2 — The fixture's long-edge guard can pass on `NaN`, and runs after the write

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/make-e2e-fixtures.mjs:108-120`
- **Detail**: `sharp().metadata()` types `width`/`height` as `number | undefined`. If either is
  undefined, `Math.max(undefined, undefined)` is `NaN` and `NaN <= 1024` evaluates `false` — the
  script logs `long edge NaN`, skips the error branch, and exits 0. `e2e/fixtures/README.md:24`
  advertises this check as *the* guarantee that `photo-gallery-desktop.spec.ts` exercises the resize
  branch rather than `downscale.ts:32-34`'s pass-through. Separately, the JPEG is written at `:108`
  and only validated at `:112-120`, so a failed check sets `process.exitCode = 1` but leaves the bad
  fixture on disk, ready to be committed over the good one.
- **Fix**: Validate the in-memory buffer before `writeFile`, and guard the undefined case:
  `if (!width || !height || Math.max(width, height) <= 1024) { … }`.
- **Decision**: FIXED — validation moved ahead of `writeFile` and now reads the in-memory buffer;
  the undefined pair is guarded, with the `NaN <= 1024` trap noted in the comment. Re-run: exit 0,
  `1600x1200`, fixtures byte-identical (clean `git status`).

### F3 — CI still doesn't run `npm test`, and the seam's safety argument now rests on it

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml:18-21`
- **Detail**: CI runs `npm ci` → `astro sync` → `lint` → `build`, never `npm test`. Both
  `src/lib/services/vision.ts:79-81` and `test/stubs/astro-env-server.ts:21-25` describe the Vitest
  suite as "standing evidence that the default state is dead," and `src/lib/services/vision.test.ts`
  is the only enforcement anywhere that a production bypass path stays fail-closed. Nothing on a PR
  runs it; the husky `vitest related --run` hook mitigates locally but is skippable. This is a
  *known, scheduled* gap — `test-plan.md:154` and §3 row 5 both put the CI test gate in rollout
  Phase 5 — so it is not drift from this change. What changed is the cost of the gap: before this
  phase, an unrun suite meant unnoticed logic regressions; now it also means an unnoticed
  production-safety regression.
- **Fix A ⭐ Recommended**: Add `- run: npm test` to `ci.yml` now, ahead of Phase 5.
  - Strength: One line, no new infrastructure (unlike the e2e and db-policy gates, which need service
    containers). Closes the enforcement gap on the guard this change just introduced.
  - Tradeoff: Pulls a sliver of Phase 5's scope forward; the §5 gate table would need its status
    updated so the docs don't go stale.
  - Confidence: HIGH — the suite runs green in 2.8s with no external dependencies.
  - Blind spot: None significant.
- **Fix B**: Leave it to Phase 5 as planned; record the elevated stakes in `test-plan.md` §5.
  - Strength: Keeps rollout-phase boundaries clean; Phase 5 wires all three gates coherently.
  - Tradeoff: Every PR until Phase 5 lands can disarm or invert the guard with a green CI.
  - Confidence: MEDIUM — depends how soon Phase 5 starts.
  - Blind spot: Haven't checked whether branch protection currently requires the CI job at all.
- **Decision**: FIXED via Fix B — `ci.yml` left alone; `test-plan.md` §5 gains a paragraph recording
  that the `npm test` gate's stakes rose in Phase 4 (vision.test.ts is the only enforcement of the
  seam's fail-closed locks), that a PR can disarm the guard with a green CI until Phase 5, and that
  Phase 5 should wire `- run: npm test` first, ahead of the container-dependent gates.

### F4 — "Four guard cases" is stale in four documents; the file has seven tests

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `e2e/RULES.md:103`, `context/foundation/test-plan.md:119,290,954`
- **Detail**: The plan specified four guard cases; the implementation shipped seven (the four planned,
  plus the empty-string-key edge, a no-title case, and the platform-default case) — a justified
  superset. The four documents written in Phase 5 still say "four". Confirmed: `vitest run
  src/lib/services/vision.test.ts` reports 7 tests.
- **Fix**: Change "four"/"4 cases" to "seven" in all four locations.
- **Decision**: FIXED — all four updated. Landed at "seven", then re-corrected to **ten** in the same
  pass once F8 added three guard cases; the §4 total moved 235 → 238 with them.

### F5 — A failed spec run leaks its row into the shared local library

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `e2e/photo-capture-mobile.spec.ts:195-200`, `e2e/photo-gallery-desktop.spec.ts:209-214`
- **Detail**: Both specs persist a row server-side at the capture / file-selection step, which is
  *before* the first assertion that can fail (`response.status()`, the `"Edit game"` dialog,
  `rows.first()`). Cleanup is the last statement of the test body, so any red run leaks the row
  permanently into the shared `E2E_EMAIL` account, and rows accumulate across iterations. The manual
  criteria 3.4 / 4.4 ("no rows left behind") therefore only hold on green runs. `seed.spec.ts` shares
  the inline-cleanup shape and there is no `afterEach` anywhere in `e2e/`, so this is the established
  pattern rather than a deviation — but here the insert is automatic and invisible rather than driven
  by an explicit dialog.
- **Fix**: Wrap the body in `try`/`finally` (or move the delete loop into a `test.afterEach` keyed on
  the timestamped title) in both specs.
- **Decision**: FIXED — took the `test.afterEach` option (smaller diff than re-indenting both bodies,
  and `testInfo.status` is the reliable signal for how loudly cleanup should fail). The delete loop
  now lives in `e2e/helpers/cleanup.ts`'s `removeRowsTitled`: asserted on a green run, best-effort on
  a red one so a cleanup throw can't mask the real failure, with a `page.goto("/library")` first on
  red to escape a modal the failure left open. **Falsified both directions** (2026-07-27,
  `photo-gallery-desktop.spec.ts`): a forced failure right after the identify 200 leaks **1** row
  with the hook stubbed out and **0** with it live — verified against the local Supabase table, and
  both rows recorded in that spec's falsification log. `e2e/RULES.md`'s cleanup rule now states the
  before-the-first-assertion condition that makes `afterEach` mandatory.

### F6 — `clickUntilRevealed` is duplicated verbatim across both specs

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `e2e/photo-capture-mobile.spec.ts:114-119`, `e2e/photo-gallery-desktop.spec.ts:100-105`
- **Detail**: The helper is copied byte-for-byte into both files, and `e2e/RULES.md:36-43` already
  calls it "the shared shape" while pointing at one copy's line number. There is no `e2e/helpers/`
  directory yet; this is the second consumer, which is normally the point at which one is created.
  `photo-gallery-desktop.spec.ts:95` cross-references the other file for the rationale, so the
  duplication is acknowledged rather than accidental.
- **Fix**: Extract to `e2e/helpers/hydration.ts`, import in both specs, and repoint the `RULES.md`
  reference.
- **Decision**: FIXED — `e2e/helpers/` created with two modules: `hydration.ts` (`clickUntilRevealed`,
  carrying the full rationale that used to live in the mobile spec) and `cleanup.ts`
  (`removeRowsTitled`, which also absorbs the second duplication F5's fix would otherwise have
  introduced). `RULES.md` now points at the helper and says to import rather than re-copy it.
  `pickFileUntilChooserOpens` stays local to the gallery spec — single consumer — with its
  cross-reference repointed at the helper module. Net: the desktop spec no longer needs
  `clickUntilRevealed` at all.

### F7 — "The run is now offline and provider-free" overstates what happens locally

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/foundation/test-plan.md:123` (§4 e2e row)
- **Detail**: The seam removes the *vision* hop only. `identify.ts:166` still calls
  `lookupGameMetadata` on every photo-spec run, which is a live Twitch OAuth + IGDB round-trip
  whenever `TWITCH_CLIENT_ID/SECRET` are present in `.dev.vars` — which they are for anyone who has
  run the harness. The outcome is deterministic either way (a timestamped title can never match, and
  the throw is swallowed at `identify.ts:167-169`), which is exactly the argument
  `seed.spec.ts:23-27` already makes. §5's CI contract is accurate as written — it says what the
  suite *needs* — but §4's stronger "offline and provider-free" could lead a reader to conclude the
  run is hermetic when it still makes outbound calls locally.
- **Fix**: Reword §4 to "no *vision* provider call and no `OPENROUTER_API_KEY`; IGDB still runs when
  configured, but a timestamped title never matches, so the outcome is identical whether it answers
  or not."
- **Decision**: FIXED — §4's claim narrowed to "makes no vision-provider call", with the IGDB
  round-trip named explicitly, the reason it stays deterministic spelled out
  (`identify.ts:167-169` swallows the throw; a timestamped title never matches), and a note on why
  §5's CI contract is narrower.

### F8 — Seam key comparison is neither trimmed nor constant-time

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/vision.ts:104,107`
- **Detail**: Two marginal hardening points on an otherwise genuinely fail-closed guard. (a) The
  comparison at `:107` is a plain `!==` string compare — non-constant-time, and it is the only lock
  once the server is armed. Irrelevant in production, where lock 1 at `:104` is unconditionally
  closed, but it is what stands between a caller and arbitrary control of the vision read if the key
  is ever set in a shared staging environment. (b) The empty-string case is handled and tested
  (`vision.test.ts:53-61`), but a whitespace-only or accidentally-padded key (`" abc "` copied out of
  `.dev.vars`) passes lock 1 and is then unmatchable, because RFC 7230 strips leading/trailing OWS
  from header values. It still fails closed — but the operator sees an "armed" config producing
  unexplained 502s.
- **Fix**: `const key = E2E_VISION_STUB_KEY?.trim(); if (!key) return null;` and compare the header
  against `key`; note the timing-comparison choice in the JSDoc, or replace `!==` with a
  length-independent XOR loop.
- **Decision**: FIXED — both halves. Lock 1 now trims (whitespace-only reads as unset); lock 2 trims
  the header for symmetry and compares through a new `constantTimeEquals` that folds the length
  difference into the accumulator, with the JSDoc stating why it is hand-rolled rather than
  `crypto.timingSafeEqual` (sync, workerd + node) and what it does *not* hide (the loop spans the
  longer input). Guarded by three new cases in `vision.test.ts` — whitespace-only key, a
  stray-whitespace server key that must still match, and near-miss keys differing only in length or
  final character. Falsified: reverting the guard to the old `!==` reddens the stray-whitespace case.
  Suite is now **10 cases / 238 total**, and the counts corrected under F4 were re-corrected to match.
