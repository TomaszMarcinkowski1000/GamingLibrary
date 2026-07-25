<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Grounding & identify-seam integration tests (test-plan Phase 1)

- **Plan**: `context/changes/testing-grounding-identify-seam/plan.md`
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-07-25
- **Verdict**: NEEDS ATTENTION → **triaged 2026-07-25** (7 fixed, 1 skipped)
- **Findings**: 0 critical, 4 warnings, 4 observations

## Triage outcome (2026-07-25)

| | Findings |
|---|---|
| Fixed | F1 (Fix A), F2, F3 (Fix A), F4, F5, F7, F8 (alias only) |
| Skipped | F6 — limitation already documented |

Post-triage verification: `npm test` → 9 files / 172 tests passed; `npm run lint` → clean; `npx astro check` → 0 errors, 0 warnings, 5 hints.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Success criteria re-run at HEAD: `npm test` → 9 files / 172 tests passed; `npm run lint` → clean; `npx astro check` → 0 errors, 0 warnings, 5 hints. All 18 Progress checkboxes are `[x]` with commit shas.

Plan Adherence note: 18 of 21 planned assertions land exactly as specified. The Phase-4 per-phase note landed in test-plan **§6.7**, not the planned §6.6 (§6.6 was claimed by the out-of-scope Stryker cookbook — see F3). Content is complete; numbering only.

## Findings

### F1 — Planned credential-leak guard was silently downgraded to a test that cannot fail

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality / Plan Adherence
- **Location**: `src/pages/api/identify.test.ts:305-323`, `src/pages/api/identify.ts:108`
- **Detail**: Plan Phase 3 item 4 required "GET path with IGDB stubbed to throw an error **whose message embeds a Twitch-token-like string** → 502 body contains neither the Twitch secret nor a bearer token". The implemented test instead stubs `/v4/games` to a plain `500` with body `"igdb upstream boom"` and asserts the 502 body lacks `test-twitch-token` / `test-twitch-client-secret`. Because `identify.ts:108` returns `error.message` **verbatim with no redaction**, the planned version would have gone red — it would have exposed a real production gap. The substituted assertion can only fail if the IGDB wrapper itself starts embedding credentials in its error text, i.e. it is unfalsifiable by anything the route does. The test compensates by proving the credential transits the pipeline (token minted, `authorization` header carries the bearer), which is genuine evidence but not a leak guard. The gap is recorded nowhere — not in the plan's "What We're NOT Doing", not in test-plan §6.7's known-gaps list alongside the empty-title and ambiguity gaps.
- **Fix A ⭐ Recommended**: Record the missing redaction as a third known gap (test-plan §6.7 + this plan's "NOT doing"), and add a comment at `identify.test.ts:305` stating the assertion is a regression tripwire, not proof of redaction.
  - Strength: Matches how the other two production gaps discovered during this phase were handled (recorded, not fixed) — this phase's own charter forbids production behavior changes, so redaction belongs in a follow-up change.
  - Tradeoff: The leak surface stays open until someone picks up the follow-up.
  - Confidence: HIGH — the phase explicitly scoped itself to tests only, and the two sibling gaps are already documented this exact way.
  - Blind spot: Whether the IGDB wrapper's error messages can in practice carry the bearer (not audited).
- **Fix B**: Add redaction at `identify.ts:105-109` (map any grounding throw to a status-only message) and restore the plan's stronger test with a token-embedding error.
  - Strength: Actually closes the surface, and the plan's assertion then becomes load-bearing.
  - Tradeoff: A production behavior change inside a phase that declared "no production behavior changes" — the same guardrail F3 already breached.
  - Confidence: MEDIUM — the change is a few lines, but the harness relies on distinguishing transport failures, so collapsing all messages may reduce debuggability.
  - Blind spot: Whether any consumer parses the current pass-through error text.
- **Decision**: FIXED via Fix A — recorded as a third known gap in test-plan §6.7 and in plan.md's "What We're NOT Doing"; tripwire comment added at `identify.test.ts:305`.

### F2 — The IGDB-no_match save-face test passes even when the IGDB route is never hit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (test reliability)
- **Location**: `src/pages/api/identify.test.ts:151-167`, and the same shape at `:189-201`
- **Detail**: `identify.ts:157-161` swallows **any** throw from `lookupGameMetadata` and leaves `grounding = null`; `metadataFromGrounding` (`src/lib/services/library.ts:110-119`) maps both `null` and `no_match` to the identical `{ igdb_id: null, metadata_status: "no_match" }`. So the assertions at `:164-166` hold whether IGDB genuinely returned zero candidates or the grounding call exploded. Verified empirically during review: re-running the test body with the `/v4/games` route **deleted** (so the router raises its loud "Unexpected fetch") still passes green — `identified` / `igdbId: null` / `metadata_status: "no_match"` / insert called once. The fetch helper's "unrouted URL fails visibly" guarantee is defeated by the route's best-effort catch. The sibling GET test at `:305-323` gets this right by asserting `router.requests` recorded the calls.
- **Fix**: Capture `mockProviders()`'s return in both tests and assert the grounding call actually happened — `expect(r.requests.some((req) => req.url.includes("/v4/games"))).toBe(true)`.
- **Decision**: FIXED — both the persist save-face test and the persist-off fold now pin that `/v4/games` was actually requested.

### F3 — Stryker tooling, a mutation pass, and a CLAUDE.md policy section landed under this change despite the plan excluding them

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: commits `5cb79d1`, `1194e0d`, `92e3728` (all after the plan's epilogue `302989a`)
- **Detail**: `plan.md:99-100` states "**Not running Stryker this phase.** Boundary fixtures at the `isConfidentMatch` constants are added, but no mutation-testing gate is stood up." Three post-epilogue commits did exactly that: `5cb79d1` added `stryker.config.json`, the `test:mutation` npm script, ~1473 lines of lockfile churn, a `.gitignore` entry, and a standing **"## Mutation testing" section in CLAUDE.md**; `1194e0d` added 5 tests derived from an actual Stryker run (igdb.ts 59.96→64.82, identify.ts 47.70→54.02); `92e3728` wrote a 64-line §6.6 mutation cookbook that displaced the planned per-phase note to §6.7. Mitigating: no *gate* was wired (ad-hoc npm script, absent from CI and `.husky/pre-commit`), the 5 added tests are behavioral and non-mirroring, and no production source changed. But the CLAUDE.md + test-plan §6.6 edits make this a durable repo-wide policy addition attributed to a change that disclaimed it.
- **Fix A ⭐ Recommended**: Add a short addendum to `plan.md`'s "What We're NOT Doing" recording that the Stryker exclusion was reversed post-epilogue, naming the three commits.
  - Strength: Preserves work that is already merged and demonstrably useful; keeps the plan honest as the ground truth future reviews read from.
  - Tradeoff: The plan becomes a moving target; a reader must notice the addendum contradicts the bullet above it.
  - Confidence: HIGH — the tooling is already relied on by the *next* change (`testing-recommender-behavior-hardening` phase 4 ran a selective mutation pass), so removal is not on the table.
  - Blind spot: Whether the CLAUDE.md policy section was reviewed as a standing repo rule by anyone, or just carried along.
- **Fix B**: Split the Stryker work out into its own retroactive change folder and leave this plan's guardrail intact.
  - Strength: Keeps scope discipline strict and makes the tooling decision separately discoverable.
  - Tradeoff: Bookkeeping churn on already-merged history for no code benefit.
  - Confidence: MEDIUM — depends how much the project values per-change provenance.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — addendum added under plan.md's "Not running Stryker this phase" bullet, naming `5cb79d1` / `1194e0d` / `92e3728` and noting no gate was wired.

### F4 — Six route tests execute with the real `globalThis.fetch` installed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (test reliability)
- **Location**: `src/pages/api/identify.test.ts:247-266`, `:279-282`, `:300-303`
- **Detail**: `mockProviders()` is not called in the 401 tests or the four upload-rejection tests. They pass today only because `identify.ts` returns 400/401 before reaching `identifyGameFromPhoto`. There is no backstop: `vitest.config.ts` declares no `setupFiles`, and the env stub supplies a non-empty `OPENROUTER_API_KEY` (`test/stubs/astro-env-server.ts:19`). If validation ordering ever changes — e.g. the mime check moves after the vision call — these tests would issue a **live request to `openrouter.ai`** rather than failing.
- **Fix**: Add `test/setup/no-network.ts` wired via `test.setupFiles` that installs a deny-all `globalThis.fetch` in a global `beforeEach` and restores it in `afterEach`; `installFetchRouter` then overrides it per test. Hermeticity becomes a property of the suite instead of each test remembering to install a router.
- **Decision**: FIXED — `test/setup/no-network.ts` added and wired via `vitest.config.ts` `setupFiles`. Verified with a throwaway probe test that an unstubbed `fetch("https://openrouter.ai/...")` now rejects with "Blocked network call"; full suite stays green (172 tests).

### F5 — Normalize-before-ground asserts the normalized platform only via the saved payload, not the outgoing IGDB body

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/pages/api/identify.test.ts:205-226`
- **Detail**: Plan Phase 3 item 3 required the `/v4/games` **request body** to carry the normalized title *and* platform. The test asserts the title (`:222-223`) but reads the normalized platform only off the captured Supabase payload (`:225`). Mitigating: `resolvePlatformIds` maps both `"ps5"` and `"PlayStation 5"` to id `167`, so an outgoing-body platform assertion would be vacuous by construction — the drift is arguably the correct call.
- **Fix**: Add a one-line comment at `:224` explaining why the platform is asserted on the payload rather than the outgoing body (the alias collapses to the same IGDB id), so a future reader does not read it as an oversight.
- **Decision**: FIXED — comment added explaining that `resolvePlatformIds` maps both spellings to id 167, so the saved value is the only place the normalization is observable.

### F6 — `NAME_SIM_FLOOR` "at-floor" fixture sits at 0.40, leaving the `<` vs `<=` direction unpinned

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/services/igdb.integration.test.ts:233-258`
- **Detail**: The plan asked for boundary fixtures "exactly at / just below" each constant. The `NAME_SIM_STRONG` pair achieves exactly 0.80 and the `POP_FLOOR` pair exactly 5, but the `NAME_SIM_FLOOR` pair is 0.40 above / 0.333 below — Sørensen–Dice over token sets cannot produce exactly 0.34. The constant's *value* is pinned; its comparison *direction* is not. Already acknowledged as a conscious ignore in test-plan §6.6.
- **Fix**: None required — the limitation is documented. Leave as-is.
- **Decision**: SKIPPED — accepted as-is; the limitation is already recorded in test-plan §6.6.

### F7 — The `game_time_to_beats` stub answers regardless of `game_id`, so `lengthHours` is not proven to read off the collapsed base

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (test reliability)
- **Location**: `src/lib/services/igdb.integration.test.ts:52-54`, assertion at `:126`
- **Detail**: The length follow-up route returns its payload for any request body, so `lengthHours: 15` would still be produced if `igdb.ts:524` queried the **edition** id (201) instead of the collapsed base id (200). Since the metadata-off-the-base property is this suite's headline guarantee, that gap sits directly on the seam.
- **Fix**: In the metadata-leak-guard test, assert the recorded `/v4/game_time_to_beats` request body contains `game_id = 200`.
- **Decision**: FIXED — the leak-guard test now asserts the recorded time-to-beats body contains `game_id = 200`; it passes, confirming the follow-up really queries the collapsed base.

### F8 — Helper imports bypass the alias convention, and three fixture builders are duplicated

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/services/igdb.integration.test.ts:3`, `src/pages/api/identify.test.ts:3`; duplication at `igdb.test.ts:13`, `igdb.integration.test.ts:20`, `identify.test.ts:37`, `identify.test.ts:43-52`
- **Detail**: Both new suites reach the helper via `"../../../test/helpers/fetch-mock"` while CLAUDE.md's convention is the `@/` alias for cross-directory imports (both files use `@/lib/supabase` / `@/types` elsewhere); `test/` simply has no alias. Separately, `game()` is now duplicated three times, `platforms()` twice, and `insertClient()` is a near-verbatim copy of `library.test.ts:23-35` — the comments themselves say "mirrors …". The duplication predates this change but `test/helpers/` now exists as the obvious home.
- **Fix**: Add `"@test/*": ["./test/*"]` to `tsconfig.json` `paths` and the matching `resolve.alias` entry in `vitest.config.ts` (mirroring how `astro:env/server` is already wired), then switch both imports. Fixture extraction can wait for the next test change.
- **Decision**: FIXED (alias only) — `@test/*` added to `tsconfig.json` paths and `vitest.config.ts` `resolve.alias`; both suites now import `@test/helpers/fetch-mock`. Fixture duplication deliberately left for a future test change.

## Checks that came back clean

- **No production source touched.** `git diff --name-status 5999a94~1..HEAD -- src/` over this change's commits shows only added `*.test.ts` files. The empty-title gap (`vision.ts:33` still `z.string()`) and the absent ambiguity disambiguation (`igdb.ts:403`) are untouched and correctly recorded as known gaps in test-plan §6.7.
- **Hard rules honored.** `igdb.integration.test.ts` contains zero `vi.mock` — `collapseToBaseGame`, `isConfidentMatch`, the field map, and the real wrapper query serialization all execute. `identify.test.ts` does not mock `@/lib/services/vision`, so the real normalizers are in the path.
- **No secrets committed.** `test/stubs/astro-env-server.ts:17-19` holds only obvious dummies; `SUPABASE_*` deliberately `undefined`; `.env` / `.dev.vars` remain gitignored with only `.example` variants tracked.
- **Teardown and isolation.** `afterEach` calls `router?.restore()` in both suites and runs regardless of test outcome; `igdb-token-cache.ts` holds no module-level state; `holder.supabaseClient` resets in `beforeEach`; no `Date.now()`, real timers, or unseeded randomness.
- **No assertions hidden in never-invoked callbacks.** Every route is a static `{ json }` / `{ status, body }` object; `.find()`-based assertions use `expect(x?.y)` so an undefined match fails rather than skips.
- **Config wiring.** `vitest.config.ts` `include: ["src/**/*.test.ts"]` picks up `*.integration.test.ts` and correctly excludes `test/helpers/` and `test/stubs/` from collection. The pre-commit `vitest related --run` associations resolve for all four files.
- **Assert-on-shape rule followed.** Both persist-save tests read the captured `payload()` (`metadata_status` / `igdb_id`), never mere insert invocation. Note the response-level `metadataStatus` assertions at `:164` / `:180` are circular through the stub (which echoes the payload back) — they are not load-bearing, since the `payload()` assertion on the next line is the real oracle.
