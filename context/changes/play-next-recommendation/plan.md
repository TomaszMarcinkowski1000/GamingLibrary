# "What should I play next?" Recommendation — Implementation Plan

## Overview

Implement the PRD's reason-to-exist (US-03, FR-015/016/018): a **deterministic recommender** that returns a ranked list of games from the user's own library, biased by a **multi-select length-bucket dial** and one of **three novelty modes** (new releases / newly bought / comfort). 100%-completed games are de-prioritized (excluded outright in the two "new" modes), and when nothing qualifies the user sees an explanatory empty-state that names the binding constraint.

Delivered as a **server-rendered `/play-next` page** (no API route, no React island): dials are read from URL query params, the recommendation is computed in the page frontmatter via a pure, unit-tested scoring engine, and the top 10 results render server-side. This keeps the feature deep-linkable, deterministic, and trivially testable.

## Current State Analysis

All data the recommender reads already exists on `library_entries` — **no migration is required**:

- `play_status` text — one of `not_played` / `playing_now` / `played` / `completed` / `completed_100` (`src/types.ts:25`).
- `length_hours` numeric, **nullable** — IGDB time-to-beat in hours; coverage is sparse (roadmap F-02 flagged "handle missing length as unbucketed; S-07 absorbs the gap").
- `release_date` ISO date, **nullable** — platform-matched IGDB release date.
- `date_bought` date, nullable (defaults to today at create time); `created_at` timestamptz — the fallback recency signal.

Patterns to follow:

- **SSR page reading query params + calling a service in frontmatter**: `src/pages/library/index.astro:1-90` (parses params, `createClient`, calls services in a guarded `try`, degrades gracefully on error, builds `pageHref` preserving params).
- **Service layer**: `src/lib/services/library.ts` — typed functions taking `SupabaseClient<Database>`, RLS-scoped, return typed `LibraryEntry`. `listLibraryEntries` (line 171) is paginated; the recommender needs **all** eligible entries, so a new all-entries fetch is required.
- **Shared types + enums**: `src/types.ts` (`LibraryEntry`, `PLAY_STATUSES`, `PLAY_STATUS_LABELS`).
- **Validation with zod**: `src/lib/validation/library.ts` (schema + `z.infer` + compile-time assignability assertion pattern).
- **Vitest tests** colocated as `*.test.ts`: `src/lib/services/library.test.ts`, `src/lib/validation/library.test.ts`. Test command `npm test` (`vitest run`).
- **Library header** (`src/pages/library/index.astro:95-106`) is where the entry-point link belongs, beside the `GameDialog` "Add game" trigger.

### Key Discoveries:

- No migration, no API route, no React island needed — the SSR page + a pure scoring module is the whole surface (`src/pages/library/index.astro:1-90` is the template to mirror).
- `length_hours` and `release_date` are nullable; the scoring engine must handle nulls explicitly (null length → max bucket-distance; null release_date → worst novelty rank).
- Determinism is a hard PRD requirement (US-03: "identical inputs produce identical outputs"). The engine must be a pure function over `(entries, request)` with a total-order tie-breaker.
- A top-level `return Astro.redirect(...)` crashes the lint pass on this stack (astro-eslint-parser × no-misused-promises bug — see `src/pages/library/index.astro:57-58`). The `/play-next` page must avoid frontmatter redirects and instead clamp/normalize params in place.

## Desired End State

Signed-in user visits `/play-next` (via a "What should I play next?" link in the library header). The page loads with **all four length buckets selected + "newly bought"** and immediately shows a ranked top-10 list from their library. They change the multi-select length checkboxes and the novelty mode; each change reloads the page with new query params and a new deterministic ranking. When their selection + library yields nothing eligible, they see a sentence naming why (e.g. "Comfort mode needs games you've played — you have none yet. Try 'new releases', or mark a game as played.") instead of a blank list. Re-asking the identical question always returns the identical order.

Verification: unit tests prove every scoring rule and determinism; manual walk-through on a populated library confirms each mode/bucket combination ranks sensibly and the empty-state fires with the right reason.

## What We're NOT Doing

- **No migration / schema change** — all fields exist.
- **No API route and no React island** — the page is pure SSR with a GET form; dials submit via query-param navigation.
- **No LLM / AI-assisted ranking** — deterministic formula only (PRD Non-Goal; v2 territory).
- **No mood/genre constraint (FR-017)** — nice-to-have, deferred to v2.
- **No persistence of recommendation history**, no "I played this" write-back, no analytics logging.
- **No editing entries from this page** — acting on a result links the user back to the library; correction stays in the existing edit/delete flow.
- **No FR-009-style pagination of results** — a fixed top-10 cut.

## Implementation Approach

Two phases. **Phase 1** builds the deterministic scoring engine as a pure module plus a service that loads all the user's entries and delegates to it, with exhaustive Vitest coverage — this is where the substance and the rework risk live, so it ships first and proven. **Phase 2** wraps it in the `/play-next` SSR page (dials as a GET form, top-10 render, empty-state) and adds the library-header entry point.

### The scoring model (authoritative spec)

The engine ranks every **eligible** entry by a weighted numeric score, sorted descending, with a total-order tie-break. Weights are scaled so the terms form a strict priority: **length distance dominates → completion/status → novelty**. This preserves the PRD guarantee that the top result respects the length constraint whenever an in-bucket game exists, while honoring the user's "weighted score" preference.

**Length buckets (ordinal):** `short` `<10h` (index 0) · `medium` `10–30h` (1) · `long` `30–60h` (2) · `very_long` `60h+` (3). Boundaries are inclusive-low / exclusive-high: short `[0,10)`, medium `[10,30)`, long `[30,60)`, very_long `[60,∞)`.

**Length distance (dominant, lower = better):** for an entry with `length_hours = L`, find its bucket index `bg`; `distance = min over s in selectedBuckets of |bg − s|`. In-bucket ⇒ 0. **Null `length_hours` ⇒ `NULL_DISTANCE`** (a constant strictly greater than the max real distance, e.g. 4) — i.e. worst length term. With all four buckets selected, every real-length entry has distance 0 and only null-length entries are penalized (consistent with the graded-distance choice).

**Mode eligibility (the ONLY hard filter — drives the empty-state):**
- `new_releases` and `newly_bought`: **exclude `completed_100`** (keep `completed` as a heavily-penalized candidate).
- `comfort`: **exclude `not_played`** (comfort requires a game you've previously touched).

**Completion / status term (second priority, lower = better):**
- New modes (`new_releases`, `newly_bought`): `completed` gets a large penalty; `not_played` / `playing_now` / `played` get 0. (`completed_100` already excluded.)
- `comfort`: graded ordering — `playing_now` (0, best) < `played` < `completed` < `completed_100` (worst).

**Novelty term (third priority, rank-normalized to [0,1], higher = better):**
- `new_releases`: rank by `release_date` descending (newer better); **null `release_date` ranks worst** (treated least-recent).
- `newly_bought`: rank by `date_bought` (fallback `created_at`) descending (newer better).
- `comfort`: rank by `release_date` ascending (older better); null `release_date` ranks worst.
- Rank-normalization: sort the eligible set on the mode's axis, assign normalized rank position in [0,1] (ties in the raw value share a position deterministically).

**Composite score:** `score = −(W_LEN · distance) − (W_COMP · statusPenaltyNorm) + (W_NOV · novelty)` with `W_LEN ≫ W_COMP ≫ W_NOV` (e.g. 1000 / 100 / 1 over normalized component ranges) so the ordering is effectively lexicographic: length distance, then status, then novelty.

**Tie-break (total order, for determinism):** equal scores break by `created_at` ascending (oldest first), then by `id` (UUID) ascending as the final guaranteed-unique key.

**Output:** the top 10 of the ranked eligible set. If the eligible set is empty, return a structured empty-state reason.

**Empty-state reason:** computed from the filter pipeline. `EMPTY_LIBRARY` (zero entries) ⇒ "Your library is empty — add a game first." Otherwise `MODE_ELIGIBILITY` ⇒ mode-specific copy naming the excluded class and a suggested relaxation (comfort with no previously-played games; new modes where every entry is `completed_100`). Length never empties the set (graded soft penalty), so it is never the binding constraint.

## Critical Implementation Details

- **Weights must enforce strict priority.** Choose `W_LEN`, `W_COMP`, `W_NOV` such that one unit of length distance outweighs the entire range of the completion + novelty terms combined, and one unit of completion penalty outweighs the entire novelty range. This is what makes "top result respects the length constraint" provable and keeps the model behaving like the user's stated tiered intent while remaining a single weighted score. A unit test must assert an in-bucket `completed` game outranks an out-of-bucket `not_played` game in a new mode.
- **Determinism hinges on a total order.** Rank-normalization and every sort must be stable and fully ordered down to `id`; never rely on input array order or `Array.prototype.sort` default string coercion for numbers/dates.
- **Avoid frontmatter `Astro.redirect`** on the `/play-next` page (lint-crash, see `src/pages/library/index.astro:57-58`); normalize invalid/missing query params to defaults in place instead.

## Phase 1: Scoring engine + service + types

### Overview

Build the pure deterministic scoring module, the shared request/result types, and the service that loads all of a user's entries and delegates to the engine. Cover every rule with Vitest.

### Changes Required:

#### 1. Recommendation domain types

**File**: `src/types.ts`

**Intent**: Add the shared vocabulary the engine, service, and page all agree on — length buckets, novelty modes, the request shape, a ranked result item, and the discriminated recommendation result (ranked list vs. empty-state reason).

**Contract**: Add `LENGTH_BUCKETS = ["short","medium","long","very_long"] as const` with a `LengthBucket` type and a `LENGTH_BUCKET_BOUNDS` map (index + `[minH, maxH)` per bucket) and `LENGTH_BUCKET_LABELS`; `NOVELTY_MODES = ["new_releases","newly_bought","comfort"] as const` with `NoveltyMode` type and `NOVELTY_MODE_LABELS`. Add `RecommendationRequest = { lengthBuckets: LengthBucket[]; mode: NoveltyMode }`. Add `RecommendationItem = { entry: LibraryEntry; score: number }` (or `entry` + the component breakdown if useful for debugging). Add `EmptyReason = "empty_library" | "mode_eligibility"`. Add the discriminated result `RecommendationResult = { status: "ranked"; items: RecommendationItem[] } | { status: "empty"; reason: EmptyReason; mode: NoveltyMode }`.

#### 2. Pure scoring engine

**File**: `src/lib/services/recommendation.ts` (new)

**Intent**: A single pure function that takes the full eligible-or-not entry set plus a `RecommendationRequest` and returns a `RecommendationResult` — no Supabase, no I/O, no clock. This is the deterministic core implementing the scoring model above.

**Contract**: Export `recommend(entries: LibraryEntry[], request: RecommendationRequest, limit = 10): RecommendationResult`. Internal pure helpers (exported for unit tests): `bucketOf(lengthHours: number | null): LengthBucket | null`; `lengthDistance(entry, selectedBuckets): number` (null length ⇒ `NULL_DISTANCE`); `isEligible(entry, mode): boolean`; `statusPenalty(entry, mode): number`; `noveltyRank(entries, mode): Map<id, number>` (rank-normalized [0,1], null dates worst); `scoreOf(...)`; and the final stable sort with the `created_at`→`id` tie-break. The composite-score weights live as named module constants (`W_LEN`, `W_COMP`, `W_NOV`, `NULL_DISTANCE`). No code snippet — the model spec above is the contract.

#### 3. All-entries service fetch + recommendation service

**File**: `src/lib/services/library.ts` (extend) and/or `src/lib/services/recommendation.ts`

**Intent**: Add a service that loads **all** of the signed-in user's entries (RLS-scoped, not paginated) and delegates to `recommend()`. The library currently only exposes the paginated `listLibraryEntries`; the recommender needs the whole set.

**Contract**: Add `listAllEntries(supabase: SupabaseClient<Database>): Promise<LibraryEntry[]>` to `src/lib/services/library.ts` (select the columns the engine reads; RLS scopes to the user; deterministic order from the DB is irrelevant since the engine re-sorts). Add `getRecommendations(supabase, request): Promise<RecommendationResult>` (in `recommendation.ts`) that calls `listAllEntries` then `recommend`. Errors propagate to the page's `try`/`catch` (mirroring `library/index.astro`).

#### 4. Request parsing/validation helper

**File**: `src/lib/validation/library.ts` (extend) or a small parser in `recommendation.ts`

**Intent**: Parse the `/play-next` query params into a normalized `RecommendationRequest`, applying defaults (all four buckets + `newly_bought`) and dropping unknown values, so the page frontmatter stays thin and the normalization is unit-testable.

**Contract**: Export `parseRecommendationParams(searchParams: URLSearchParams): RecommendationRequest`. Length read from repeated `?length=` (or comma-joined) values, filtered to known `LengthBucket`s; empty/all-invalid ⇒ all four (default). Mode read from `?mode=`, validated against `NOVELTY_MODES`; invalid/missing ⇒ `newly_bought`. Follow the zod + `z.infer` + assignability-assertion style of the existing schemas where a schema fits; a plain validated parser is acceptable for query strings.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- New tests cover: bucket boundary edges (9.99/10/29.99/30/59.99/60h); null-length ⇒ max distance; graded distance (short-only selected ranks medium < long < very_long); mode eligibility (new modes exclude `completed_100`; comfort excludes `not_played`); completion term (new-mode `completed` heavily penalized; comfort status ordering playing_now < played < completed < completed_100); novelty per mode incl. null-date-worst; **length dominance** (in-bucket `completed` outranks out-of-bucket `not_played` in a new mode); **determinism** (same input ⇒ identical order across repeated calls) and tie-break (created_at→id); empty-state reasons (empty library; comfort with no previously-played; new mode all-`completed_100`); top-10 truncation.

#### Manual Verification:

- A spot-check of one realistic library in a Vitest scratch case produces an intuitively sensible ranking for each mode.

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation before starting Phase 2.

---

## Phase 2: `/play-next` SSR page + entry point

### Overview

Surface the engine: a server-rendered page with a GET-form dial set, a top-10 ranked list, and the explanatory empty-state, plus a link into it from the library header.

### Changes Required:

#### 1. `/play-next` page

**File**: `src/pages/play-next/index.astro` (new)

**Intent**: Server-render the recommendation. Mirror `src/pages/library/index.astro:1-90`: create the Supabase client, parse params via `parseRecommendationParams`, call `getRecommendations` inside a guarded `try`/`catch`, and render either the ranked list or the empty-state. No frontmatter redirect.

**Contract**: `prerender` is not set (SSR page; middleware already gates auth — `/play-next` is reachable only when signed in; confirm it is covered by `PROTECTED_ROUTES` in `src/middleware.ts` and add it if not). The page reads `Astro.url.searchParams`, normalizes to a `RecommendationRequest`, and renders results. Each ranked item shows title, platform, play-status label (reuse `PLAY_STATUS_LABELS` / existing status badge classes in `src/components/library/playStatus.ts`), length, and release year, with a link to the library for acting on it. Uses `Layout`, the `bg-cosmic` page shell, and Tailwind `cn()` conventions.

#### 2. Dial form (length multi-select + novelty)

**File**: `src/pages/play-next/index.astro` (same file) — optionally a small `.astro` partial for the form

**Intent**: A `method="get"` form (no client JS) whose controls reflect the current request and, on submit, reload `/play-next` with the new query params — keeping the page deterministic and deep-linkable.

**Contract**: Length = four checkboxes named `length` with values `short|medium|long|very_long`, checked per current selection (all four checked by default). Novelty = a select or radio group named `mode` over `NOVELTY_MODES` using `NOVELTY_MODE_LABELS`, defaulting to `newly_bought`. A submit button reloads the page. Build hrefs/initial state from the normalized request, mirroring the `pageHref` param-preservation seam in `library/index.astro:85-89`.

#### 3. Empty-state copy

**File**: `src/pages/play-next/index.astro` (same file)

**Intent**: Render the structured `EmptyReason` as a human sentence that names the binding constraint and suggests a relaxation (PRD US-03).

**Contract**: Map `empty_library` ⇒ "Your library is empty — add a game first" (link to library). Map `mode_eligibility` + `mode` ⇒ mode-specific sentence: comfort ⇒ "Comfort mode needs games you've played — you have none yet. Try 'new releases', or mark a game as played."; new modes ⇒ "Every game matching is already 100% completed — try comfort mode." Pure prose; affects the empty-state block only.

#### 4. Library-header entry point

**File**: `src/pages/library/index.astro` (edit header block ~line 95-106)

**Intent**: Add a "What should I play next?" link/button in the library header beside the existing "Add game" trigger so the feature is discoverable from the primary surface.

**Contract**: An anchor to `/play-next` styled as a secondary button (reuse `Button` variant classes or matching Tailwind). No behavior change to the existing `GameDialog`. Routine markup edit — no snippet.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- Unit tests still pass: `npm test`

#### Manual Verification:

- Visiting `/play-next` signed-in loads with all four buckets + "newly bought" and shows a ranked top-10 from a populated library.
- Toggling length checkboxes and changing the mode reloads with a new, sensible ranking; the URL reflects the dial state and re-pasting the URL reproduces the exact list (determinism).
- With short-only selected and no short games, medium games appear above long above very_long.
- Comfort mode on a library with no previously-played games shows the comfort empty-state, not a blank list; emptying the library shows the empty-library copy.
- 100%-completed games never appear in new modes; under comfort they appear last.
- The library-header link navigates to `/play-next`; unauthenticated access to `/play-next` redirects to sign-in.
- Response is comfortably under the 2s p95 NFR on a 50+ entry library.

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `src/lib/services/recommendation.test.ts` — the full rule matrix listed in Phase 1 Automated Verification, plus determinism and tie-break. This is the bulk of the testing and the main quality gate.
- `parseRecommendationParams` — defaults, unknown-value filtering, multi-select parsing.

### Integration Tests:

- None added (no API route). The SSR page is exercised by manual verification + the build.

### Manual Testing Steps:

1. Populate a test library spanning all four length buckets, several novelty/recency profiles, and every play status (incl. a `completed_100` and a null-`length_hours` entry).
2. Visit `/play-next`; confirm default load (all buckets + newly bought) and a sensible top-10.
3. Cycle each novelty mode and several bucket subsets; confirm rankings match the spec and the URL round-trips deterministically.
4. Force each empty-state (comfort with no previously-played; new mode with only `completed_100`; empty library) and confirm the right sentence.
5. Confirm the header link and the auth redirect.

## Performance Considerations

Deterministic in-memory scoring over a small (~50+) entry set fetched in one RLS-scoped query — well within the 2s p95 NFR (roadmap S-07 unknown: "deterministic scoring over a small dataset"). No caching needed at v1 scale. `listAllEntries` selects only the columns the engine reads.

## Migration Notes

None — no schema change. All consumed columns already exist on `library_entries`.

## References

- Roadmap slice: `context/foundation/roadmap.md` S-07 (lines 190-201)
- PRD: US-03, FR-015/016/018, Business Logic, Non-Functional (`context/foundation/prd.md`)
- SSR-page-with-params pattern: `src/pages/library/index.astro:1-90`
- Service + types + validation patterns: `src/lib/services/library.ts`, `src/types.ts`, `src/lib/validation/library.ts`
- Lessons: `context/foundation/lessons.md` (Cloudflare binding access — not triggered here; no new binding)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Scoring engine + service + types

#### Automated

- [ ] 1.1 Type checking passes: `npm run typecheck`
- [ ] 1.2 Linting passes: `npm run lint`
- [ ] 1.3 Unit tests pass: `npm test`
- [ ] 1.4 New tests cover the full rule matrix (buckets/distance/eligibility/completion/novelty/length-dominance/determinism/tie-break/empty-states/top-10)

#### Manual

- [ ] 1.5 Spot-check ranking on a realistic library is intuitively sensible per mode

### Phase 2: `/play-next` SSR page + entry point

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Production build succeeds: `npm run build`
- [ ] 2.4 Unit tests still pass: `npm test`

#### Manual

- [ ] 2.5 Default load shows ranked top-10 (all buckets + newly bought)
- [ ] 2.6 Dial changes reload with sensible ranking; URL round-trips deterministically
- [ ] 2.7 Short-only with no short games ranks medium < long < very_long
- [ ] 2.8 Each empty-state shows the correct binding-constraint sentence
- [ ] 2.9 100%-completed hidden in new modes, last under comfort
- [ ] 2.10 Header link navigates; unauthenticated `/play-next` redirects to sign-in
- [ ] 2.11 Response under 2s p95 on a 50+ entry library
