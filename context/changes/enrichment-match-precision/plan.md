# Precise IGDB Grounding — Implementation Plan

## Overview

Replace the single first-match IGDB grounding in `lookupGameMetadata` with a **top-N fetch +
edition-variant collapse + composite false-positive suppression**, fronted by extracted pure
functions, and add **platform-alias normalization** (psvita / psp variants / multi-platform
strings). This is roadmap slice **S-09** (`enrichment-match-precision`), promoted from `optional`
to load-bearing by the F-03 spike: the photo vision read is ~95% but strict base-game id+platform
grounding measured **71.2%** because first-match grounding lands on edition-specific IGDB entries.
Closing that grounding gap is the binding prerequisite that unblocks the north-star **S-03**.

Both grounding consumers — the photo path (`api/identify.ts`) and the manual-add path
(`library.ts` / `library/lookup.ts`) — route through `lookupGameMetadata`, so the fix lifts S-03
auto-save accuracy **and** S-01 manual-enrichment quality with no consumer changes.

## Current State Analysis

- **Grounding is one function, one line.** `lookupGameMetadata` (`src/lib/services/igdb.ts:146`)
  runs `client.games.search(title).fields(…).where(platforms ∈ ids).limit(1).first()`. The
  `.limit(1).first()` is the 71.2% bottleneck: the box reads *"Alan Wake II Deluxe Edition"*, IGDB's
  first hit is the edition entry, grounding returns the edition id, the truth label used the base id.
- **The IGDB wrapper already exposes every field needed.** The `Game` type
  (`node_modules/@api-wrappers/igdb-wrapper/dist/index.d.mts:339`) carries `parent_game`,
  `version_parent`, `version_title`, `category`, `total_rating_count`, `rating_count`, `follows`,
  `hypes`, `alternative_names`, `name`. The `QueryBuilder` supports `.sort()`, `.limit()`,
  `.offset()`, `.findMany()`/`.query()` (array results) alongside the `.first()` used today
  (`…/index.d.mts:124`).
- **Nested relation expansion already works in this codebase.** The current query selects
  `genres.name`, `involved_companies.company.name`, `release_dates.platform` — multi-level nested
  field selection is proven, so `parent_game.genres.name` etc. is expected to expand inline.
- **Platform map has located gaps.** `PLATFORM_IDS_BY_NAME` (`igdb.ts:62`) has `"ps vita"→46` but
  not `"psvita"`; `normalizePlatform("PSVita")` → `"psvita"` → unmapped → unfiltered search +
  string-equality scoring miss. Multi-platform strings (`"Xbox Series X • Xbox One"`) also miss. The
  F-03 results enumerate exactly 4 such platform-string artifacts (immortals-fenyx-rising,
  crash-tag-team-racing, danganronpa, the-swapper).
- **The map is hand-duplicated in the harness.** `scripts/identify-harness.mjs:42` keeps a copy of
  `PLATFORM_IDS_BY_NAME` + `normalizePlatform` + a `platformsMatch` (line 85) with a comment
  warning to mirror any growth. The harness `platformsMatch` is also where the 4 artifacts fail.
- **Grounding code is untested.** There is no `src/lib/services/igdb.test.ts` (the lookup hits the
  network). `igdb.ts` already follows a pure-helper style (`normalizePlatform`, `resolvePlatformIds`,
  `names`, `toIsoDate`, `releaseDatePlatformId`) — the new logic extends that pattern.
- **The acceptance re-measure is manual.** `npm run harness` (`identify-harness.mjs`) drives
  `/api/identify` over `fixtures/shelf/` photos + `labels.csv`, both **gitignored / local-only**.
  Automated CI verification is therefore unit tests + lint + typecheck + build; the ~90% re-measure
  is a manual step the user runs locally.
- **The F-03 failure set bounds the work.** `context/archive/2026-06-11-photo-identification-spike/results.md`
  enumerates every failing case by bucket: ~16 edition-variant grounding misses, 4 platform-string
  artifacts, 8 unscoreable truth-grounding failures (Polish editions + junk rows), ~2 genuine vision
  misses. The plan validates against this enumerated set.

## Desired End State

`lookupGameMetadata(title, platform, kv)` returns the **base-game** IGDB id (not the edition id) for
edition-variant boxes, degrades thin/ambiguous terms to `no_match` instead of attaching wrong
metadata, and resolves platform aliases (psvita / psp / multi-platform) correctly — while never
regressing recall below today except where false-positive suppression deliberately fires. A local
re-run of `npm run harness` on a cleaned truth set clears **~90%** base-game id+platform accuracy.

Verification: pure collapse / scoring / platform functions are unit-tested against F-03-derived
fixtures; `npm run lint`, `astro check` (typecheck), `npm run build`, and `npm run test` pass; the
manual harness re-measure reaches ~90%.

### Key Discoveries:

- First-match grounding is the single binding constraint (`igdb.ts:173`), confirmed by the F-03
  error decomposition (`results.md:30-39`).
- IGDB `Game` exposes `parent_game` / `version_parent` / `version_title` / `category` and popularity
  signals (`total_rating_count`, `follows`, `hypes`) inline — no schema work needed
  (`index.d.mts:339-396`).
- Nested relation selection (`parent_game.genres.name`) is expected to expand inline given the
  existing `involved_companies.company.name` precedent (`igdb.ts:155-164`) — Phase 2 confirms and
  falls back to a by-id fetch if not.
- The platform map duplication contract (`igdb.ts:59-61`, `identify-harness.mjs:38-40`) means every
  Phase 1 map edit must land in both files.

## What We're NOT Doing

- **No `IgdbLookupResult` contract change.** It stays `matched | no_match`; collapse is internal, the
  id simply becomes the base-game id. Any confidence/low-confidence signal for confirm-before-save is
  **deferred to S-03**.
- **No confirm-before-save UX, no persistence changes, no S-03 work.** This slice is grounding-only.
- **No client-side image rectification (opencv.js).** F-03 showed skew is not a dominant error driver.
- **No model/vision changes.** The vision read is ~95%; the gap is grounding-side.
- **No committed truth-set cleaning script.** `labels.csv` is local-only; cleaning is documented as
  manual steps, not tooling.
- **No fuzzy/token platform resolver.** The console set is fixed; we extend the exact alias map.
- **No re-architecture of the two consumers.** They keep calling `lookupGameMetadata` unchanged.

## Implementation Approach

Work front-by-front, lowest-risk foundation first: **platform normalization** (Phase 1) is
independent and unblocks the 4 platform-string artifacts; **edition collapse** (Phase 2) is the
dominant error source and reshapes the games query into a top-N fetch; **false-positive suppression**
(Phase 3) layers onto that same candidate set; **harness + re-measure** (Phase 4) makes the
acceptance check reproducible and runs it.

The grounding logic is extracted into **pure functions** over candidate lists
(`collapseToBaseGame`, the composite FP scorer, platform normalization/matching), so the tuning
surface is unit-tested deterministically without network or client mocks, mirroring `igdb.ts`'s
existing pure-helper style. `lookupGameMetadata` becomes a thin orchestrator: fetch top-N → collapse
→ score/threshold → map fields.

## Critical Implementation Details

- **Platform map duplication (Phase 1).** `PLATFORM_IDS_BY_NAME` + `normalizePlatform` live in both
  `src/lib/services/igdb.ts` and `scripts/identify-harness.mjs`. Every alias added in Phase 1 must be
  mirrored in both, or harness scoring drifts silently from real grounding (the existing comment at
  `igdb.ts:59` states this contract).
- **Nested relation expansion is an assumption to verify (Phase 2).** Inline-expanding
  `parent_game`/`version_parent` nested fields in the top-N query is the preferred path (zero extra
  round-trips). If the wrapper does not expand a relation's nested fields inline, fall back to a
  targeted by-id fetch of the resolved base game — do not ship edition-flavored metadata under a base
  id.
- **Recall floor (Phases 2–3).** Collapse and the FP gate must only *improve* precision. When nothing
  confidently collapses, return today's first-match id; only the composite FP gate may turn a
  first-match into `no_match`. This keeps the migration strictly non-regressing on recall except
  where suppression is intended.
- **Over-collapse is the headline risk (Phase 2).** Title-normalization that strips
  "Deluxe/GOTY/Complete/Edition/Marvel's" must not merge genuinely distinct titles. Validate the
  collapse fixtures against the F-03 enumerated cases, and prefer IGDB relations over title-stripping
  when both are available.

---

## Phase 1: Platform-alias normalization

### Overview

Close the platform-resolution gaps so psvita / psp variants and multi-platform strings resolve to the
right IGDB ids and score as equivalent — fixing the 4 enumerated platform-string artifacts and
improving grounding's platform filter. This is the independent foundation the later phases' platform
agreement signal builds on.

### Changes Required:

#### 1. Platform alias map + multi-platform parsing (grounding service)

**File**: `src/lib/services/igdb.ts`

**Intent**: Add the missing aliases (`psvita`, and any other no-space/abbreviated forms in the F-03
set) to `PLATFORM_IDS_BY_NAME`. Teach platform resolution to split multi-platform strings (separators
`•`, `/`, `,`, `|`) into parts, resolve each, and union the ids. Add an exported pure
`platformsOverlap(a, b)` helper that treats two free-text platforms as matching when their resolved
id-sets intersect (any-overlap), falling back to normalized-string equality for unmapped platforms.

**Contract**: `resolvePlatformIds(platform: string): number[]` now returns the unioned ids of all
recognized parts of a multi-platform string. New export
`platformsOverlap(a: string, b: string): boolean`. `normalizePlatform` unchanged in signature.
Existing single-platform behavior is preserved (a plain `"PlayStation 5"` still returns `[167]`).

#### 2. Mirror the map + fix `platformsMatch` (harness)

**File**: `scripts/identify-harness.mjs`

**Intent**: Mirror the expanded `PLATFORM_IDS_BY_NAME` and replace the harness's `platformsMatch`
(line 85) with the any-overlap + multi-platform-aware logic so the 4 platform-string artifacts score
as correct (same IGDB id, same console).

**Contract**: `platformsMatch(a, b)` returns true when resolved id-sets overlap (or strings match for
unmapped). Map stays a hand-copy of the TS map per the existing duplication note.

#### 3. Unit tests for platform resolution

**File**: `src/lib/services/igdb.test.ts` (new)

**Intent**: Cover `resolvePlatformIds` and `platformsOverlap` against the F-03 platform cases:
`PSVita` vs `PlayStation Vita`, `PSP (PlayStation Portable)` vs `PlayStation Portable`,
`"Xbox Series X • Xbox One"` vs `Xbox Series X`, plus an unmapped platform (Evercade) and a plain
single platform.

**Contract**: Vitest tests; pure functions only, no network.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Type checking passes: `astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- The 4 enumerated platform-string artifacts (immortals-fenyx-rising, crash-tag-team-racing,
  danganronpa, the-swapper) score as correct on a local harness run.
- No previously-passing platform resolves differently.

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: Edition-variant collapse

### Overview

Turn the first-match grounding into a top-N fetch and collapse edition variants to their base-game id
using IGDB relations first, base-title match as fallback. Source the base game's metadata so
enrichment fields reflect the base, not the edition. This recovers the dominant (~16-case) F-03 error
bucket.

### Changes Required:

#### 1. Top-N candidate fetch with expanded relation fields

**File**: `src/lib/services/igdb.ts`

**Intent**: Change Query A from `.limit(1).first()` to a top-N fetch (N≈10) returning an array of
candidates, selecting the existing fields **plus** `name`, `category`, `version_title`, the popularity
signals (`total_rating_count`, `follows`), and inline-expanded base-relation fields
(`parent_game.*`, `version_parent.*`) covering id + name + the enrichment fields. Keep the existing
platform `where` filter (now fed by Phase 1's resolution).

**Contract**: Query A returns `Game[]` (top-N). If inline expansion of a relation's nested fields is
unsupported by the wrapper, fall back to a targeted by-id fetch of the resolved base game's fields.
Latency budget has ~6.7s p95 headroom (F-03 p95 was 3.25s), so the heavier query and any rare
follow-up fetch are within NFR.

#### 2. Pure edition-collapse function

**File**: `src/lib/services/igdb.ts`

**Intent**: Extract `collapseToBaseGame(candidates, query)` — relations-first: if the best candidate
has `version_parent`/`parent_game`, resolve to that base game; else pick the best **base-title** match
among candidates (normalize titles by stripping edition tokens — Deluxe/GOTY/Complete/Collector's/
Ultimate/Special/Launch/Undead/etc. — and a leading `"Marvel's "` style prefix). Return the chosen
base `Game` (id + fields) plus which candidate it collapsed from (for harness debug in Phase 4).

**Contract**: `collapseToBaseGame(candidates: Game[], query: {title: string}): { base: Game; collapsedFrom: number | null }`.
Pure, no network. Prefers IGDB relations over title-stripping when both apply (over-collapse guard).
When nothing collapses, returns the first candidate unchanged (recall floor).

#### 3. Wire collapse into `lookupGameMetadata` + field mapping from the base

**File**: `src/lib/services/igdb.ts`

**Intent**: `lookupGameMetadata` orchestrates: fetch top-N → `collapseToBaseGame` → run the existing
field-mapping (genres, developer, series, release year/date, length via the separate
`game_time_to_beats` query keyed on the **base** id) against the resolved base game. The length query
now uses the collapsed base id.

**Contract**: Returns `IgdbLookupResult` unchanged (`matched` carries the base id + base metadata, or
`no_match`). Both consumers untouched.

#### 4. Unit tests for collapse + title normalization

**File**: `src/lib/services/igdb.test.ts`

**Intent**: Fixtures derived from the F-03 edition-variant cases (Alan Wake II Deluxe, Horizon
Forbidden West Complete ×2, Bloodborne GOTY, Marvel's Spider-Man, Armored Core VI, Dead Cells, etc.):
assert collapse resolves to the base id via relations, and via title-match when relations are absent.
Add an **over-collapse guard** test: two genuinely distinct titles sharing a prefix must NOT merge.

**Contract**: Vitest, pure functions over hand-built `Game`-shaped fixtures.

### Success Criteria:

#### Automated Verification:

- Unit tests pass (collapse + title-normalization + over-collapse guard): `npm run test`
- Type checking passes: `astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- The enumerated edition-variant cases ground to the base-game id on a local harness run.
- No genuinely-distinct title is merged (spot-check the over-collapse risk titles).
- Enrichment fields (genre/year/length) reflect the base game, not the edition.

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 3: False-positive suppression

### Overview

Layer a composite confidence gate onto the candidate set so thin/ambiguous terms (e.g. title `"e"` on
Xbox Series X) degrade to `no_match` instead of attaching wrong metadata — without dropping valid
matches.

### Changes Required:

#### 1. Pure composite confidence scorer

**File**: `src/lib/services/igdb.ts`

**Intent**: Extract a pure scorer over the chosen base candidate vs the query combining three signals:
**name similarity** (normalized token-overlap / edit-distance between query title and candidate
name/`alternative_names`), **platform agreement** (Phase 1 `platformsOverlap` between query platform
and the candidate's platforms), and a **popularity floor** (`total_rating_count`/`follows`). Return a
boolean accept/reject (degrade to `no_match`) with documented default thresholds.

**Contract**: `isConfidentMatch(base: Game, query: {title, platform}): boolean` (or a small score +
threshold). Pure. Defaults chosen to clear the F-03 `"e"`-style cases without rejecting valid short
titles (Inside / Limbo / Ori).

#### 2. Wire suppression into `lookupGameMetadata`

**File**: `src/lib/services/igdb.ts`

**Intent**: After collapse, if `isConfidentMatch` rejects, return `{ status: "no_match" }`. This is
the only path that may turn a would-be first-match into `no_match` (recall floor honored elsewhere).

**Contract**: `no_match` on rejection; otherwise `matched` with base id + fields.

#### 3. Unit tests for the scorer + thresholds

**File**: `src/lib/services/igdb.test.ts`

**Intent**: Assert rejection of thin terms (`"e"`, single-char/low-information) and acceptance of
valid short titles + the F-03 correct cases. Cover each signal: name mismatch alone, platform
disagreement, below-popularity-floor.

**Contract**: Vitest, pure functions; include the valid-short-title regression cases explicitly.

### Success Criteria:

#### Automated Verification:

- Unit tests pass (scorer + threshold + valid-short-title regression): `npm run test`
- Type checking passes: `astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Thin/ambiguous terms degrade to `no_match` (the `"e"` on Xbox Series X case) on a local harness run.
- No previously-correct match is newly suppressed (compare abstain set against the prior harness run).

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 4: Harness legibility, truth-set cleaning, acceptance re-measure

### Overview

Make the acceptance re-measure reproducible and legible, document the local-only truth-set cleaning,
and run the harness to confirm the ~90% bar.

### Changes Required:

#### 1. Per-case collapse debug output

**File**: `scripts/identify-harness.mjs`

**Intent**: Emit a `collapsedFrom → baseId` line per case (when the route surfaces it) so a tuning run
shows *why* each case passed/failed. If the `/api/identify` response doesn't already carry the
collapse origin, add a minimal debug field to the route response guarded so it doesn't change the
scored contract.

**Contract**: Console (and optionally `report.json`) gains a per-row collapse note. The scored fields
(`proposedId`, `correct`) are unchanged.

#### 2. Document truth-set cleaning

**File**: `context/changes/enrichment-match-precision/plan.md` (this file — "Migration Notes") **and**
`fixtures/shelf/README.md`

**Intent**: Write the manual truth-set cleaning steps: drop junk rows
(`rozne-wersje-demonstracyjne`, `pierdo-ki-do-fifa-06`), pin `true_igdb_id` for the 8 unscoreable
Polish-edition titles (e.g. "God of War: Duch Sparty", "Star Wars Jedi Ocalały") so they ground
deterministically. These edit local-only gitignored data, so they are instructions, not code.

**Contract**: A reproducible checklist in `fixtures/shelf/README.md`.

#### 3. Acceptance re-measure (manual)

**File**: — (operational)

**Intent**: With Phases 1–3 merged and the truth set cleaned, run `npm run harness` against a local
`npm run dev` instance and confirm accuracy-when-answered reaches ~90% base-game id+platform.

**Contract**: `report.json` shows accuracy ≥ ~90%; record the number in this change's notes.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `astro check`
- Build passes: `npm run build`

#### Manual Verification:

- `npm run harness` reaches **~90%** base-game id+platform accuracy on the cleaned truth set.
- The collapse debug output makes each pass/fail legible.
- Latency p95 stays within the 10s NFR (expected — was 3.25s).

**Implementation Note**: This phase's acceptance is inherently manual (gitignored shelf photos). Pause
for the user to run the harness and confirm the ~90% re-measure.

---

## Testing Strategy

### Unit Tests:

- `resolvePlatformIds` / `platformsOverlap`: psvita, psp variants, multi-platform `•`/`/`/`,` strings,
  unmapped platform, plain single platform.
- `collapseToBaseGame`: relations-first resolution, title-match fallback, **over-collapse guard**
  (distinct titles sharing a prefix must not merge), no-collapse first-match floor.
- Title normalization: edition-token stripping (Deluxe/GOTY/Complete/Collector's/Ultimate/Special/
  Launch/Undead), `"Marvel's "`-style prefix.
- `isConfidentMatch`: thin-term rejection, valid-short-title acceptance (Inside/Limbo/Ori), per-signal
  cases (name mismatch, platform disagreement, popularity floor).

### Integration Tests:

- None added (lookup hits the network). The harness is the integration-level check.

### Manual Testing Steps:

1. Clean the truth set per `fixtures/shelf/README.md` (drop junk rows, pin Polish-edition ids).
2. `npm run dev` (live OPENROUTER + TWITCH creds, KV binding).
3. `npm run harness` — confirm ~90% accuracy-when-answered, abstain rate sane, p95 < 10s.
4. Spot-check the over-collapse risk titles did not merge and thin terms abstained.

## Performance Considerations

The games query grows from `.limit(1)` to top-N (≈10) with more selected fields plus inline relation
expansion; a rare by-id follow-up fetch occurs only when inline expansion is unsupported. F-03
measured p95 at 3.25s against a 10s budget — ~6.7s headroom — so the heavier query is comfortably
within NFR. Token caching (`igdb-token-cache.ts`) is unchanged.

## Migration Notes

**Truth-set cleaning (local-only, manual).** `fixtures/shelf/labels.csv` is gitignored. Before the
acceptance re-measure:

- Drop junk rows carried from the source spreadsheet: `rozne-wersje-demonstracyjne`,
  `pierdo-ki-do-fifa-06`.
- Pin `true_igdb_id` for the 8 Polish-edition titles that don't ground from their Polish names (e.g.
  "God of War: Duch Sparty" → base God of War id; "Star Wars Jedi Ocalały" → Jedi Survivor id), so
  they score against the base id deterministically.

No data migration in the app/database — this slice is grounding-logic only.

## References

- Change identity: `context/changes/enrichment-match-precision/change.md`
- Roadmap slice: `context/foundation/roadmap.md` — S-09 (load-bearing for S-03)
- F-03 spike results (enumerated failure set): `context/archive/2026-06-11-photo-identification-spike/results.md`
- Grounding service: `src/lib/services/igdb.ts:146` (`lookupGameMetadata`)
- Harness: `scripts/identify-harness.mjs` (platform map mirror at `:42`, `platformsMatch` at `:85`)
- Consumers: `src/pages/api/identify.ts`, `src/lib/services/library.ts`, `src/pages/api/library/lookup.ts`
- Result types: `src/types.ts:40-65`
- IGDB wrapper `Game` fields: `node_modules/@api-wrappers/igdb-wrapper/dist/index.d.mts:339`
- Lesson (Cloudflare binding access): `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Platform-alias normalization

#### Automated

- [x] 1.1 Unit tests pass: `npm run test` — 24af835
- [x] 1.2 Type checking passes: `astro check` — 24af835
- [x] 1.3 Linting passes: `npm run lint` — 24af835
- [x] 1.4 Build passes: `npm run build` — 24af835

#### Manual

- [ ] 1.5 The 4 enumerated platform-string artifacts score as correct on a local harness run
- [ ] 1.6 No previously-passing platform resolves differently

### Phase 2: Edition-variant collapse

#### Automated

- [x] 2.1 Unit tests pass (collapse + title-normalization + over-collapse guard): `npm run test` — 21cebca
- [x] 2.2 Type checking passes: `astro check` — 21cebca
- [x] 2.3 Linting passes: `npm run lint` — 21cebca
- [x] 2.4 Build passes: `npm run build` — 21cebca

#### Manual

- [ ] 2.5 Enumerated edition-variant cases ground to the base-game id on a local harness run
- [ ] 2.6 No genuinely-distinct title is merged (spot-check over-collapse risk titles)
- [ ] 2.7 Enrichment fields reflect the base game, not the edition

### Phase 3: False-positive suppression

#### Automated

- [x] 3.1 Unit tests pass (scorer + threshold + valid-short-title regression): `npm run test`
- [x] 3.2 Type checking passes: `astro check`
- [x] 3.3 Linting passes: `npm run lint`
- [x] 3.4 Build passes: `npm run build`

#### Manual

- [ ] 3.5 Thin/ambiguous terms degrade to `no_match` (the `"e"` on Xbox Series X case)
- [ ] 3.6 No previously-correct match is newly suppressed

### Phase 4: Harness legibility, truth-set cleaning, acceptance re-measure

#### Automated

- [ ] 4.1 Linting passes: `npm run lint`
- [ ] 4.2 Type checking passes: `astro check`
- [ ] 4.3 Build passes: `npm run build`

#### Manual

- [ ] 4.4 `npm run harness` reaches ~90% base-game id+platform accuracy on the cleaned truth set
- [ ] 4.5 The collapse debug output makes each pass/fail legible
- [ ] 4.6 Latency p95 stays within the 10s NFR
