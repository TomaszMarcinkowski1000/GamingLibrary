# Filter and Sort the Library Implementation Plan

## Overview

Extend the library browse view (S-06 / US-05 / FR-019) with multi-select filters by **status, platform, genre, and series**, plus a configurable **sort**, combinable with each other and with the existing title search. State lives in the URL so it survives pagination and reload. This builds directly on the all-server, URL-param-driven seam that the S-05 title search already established — no new client-side filtering path is introduced.

`series` is an explicit addition to FR-019's stated three filters (status/platform/genre); it is already an enriched `text[]` field on the entry (identical shape to `genre`), so it rides along as both a new list column and a fourth filter at near-zero marginal cost.

## Current State Analysis

The library browse is fully server-rendered and URL-driven; there is **no** client-side filtering anywhere — React islands handle only mutations (status change, edit/delete).

- **Page**: `src/pages/library/index.astro` reads `?page` and `?q` from `Astro.url.searchParams` (lines 13–17), fetches one page server-side via `listLibraryEntries(supabase, { page, pageSize: 20, search })` plus `listUsedPlatforms` (lines 30–33), and renders an HTML table. The search UI is a native `<form method="get" action="/library">` (lines 110–149).
- **The seam is already marked for this slice**: `pageHref()` (lines 85–89) rebuilds the URL preserving *all* current params and only swaps `page`; its comment reads *"S-06 extends this same seam to thread status/platform/genre/sort."* This is exactly how filter/sort state survives pagination.
- **Service**: `listLibraryEntries` (`src/lib/services/library.ts:171–213`) builds its query through a single `buildQuery(head)` factory (line 179) that today applies only the optional `ilike("title", …)` search filter, then `fetchPage` orders by `created_at desc` and `.range()`s the page (lines 187–191). It already self-heals out-of-bounds pages (PGRST103 → clamp + re-fetch). Adding filters means chaining more conditions inside `buildQuery`; adding sort means making the `.order()` configurable.
- **Facet source**: `list_used_platforms()` RPC exists (`library.ts:223`, migration `20260611120000_list_used_platforms_rpc.sql`) returning `setof text`, used to populate the *add-form* platform combobox (curated + used). There is **no** facet source for genre or series, and none returns counts.
- **Data shapes** (`src/types.ts`, `supabase/migrations/20260606150950_*` + `20260608183408_*`): `play_status` is `text` with a 5-value CHECK, enumerated in `PLAY_STATUSES` / `PLAY_STATUS_LABELS`. `platform` is a single `text`. **`genre` and `series` are `text[]`** (arrays) — so they need array operators (`overlaps`), not `.eq()`/`.in()`. RLS scopes every query to `auth.uid() = user_id` automatically; new queries and `SECURITY INVOKER` RPCs inherit isolation for free.

### Key Discoveries:

- `pageHref()` at `src/pages/library/index.astro:85` is purpose-built to carry filter/sort params across pagination — the persistence mechanism is already half-built.
- `buildQuery` factory at `src/lib/services/library.ts:179` is the single place every filter must be chained so the initial fetch and the clamp re-fetch stay consistent.
- `genre` and `series` are `text[]` (`20260608183408_enrich_library_entries_metadata.sql`) → filter with PostgREST `.overlaps()` (the `&&` array-overlap operator) to get OR-within-dimension semantics.
- `escapeLikeTerm` (`library.ts:150`) is only relevant to the title search; the new filters match exact facet values, so no escaping is needed.

## Desired End State

A signed-in user with a populated library sees, above the table, a control bar with: the existing title search, four multi-select filters (status, platform, genre, series) whose options are the values they actually own with per-value match counts (e.g. "PlayStation 5 (12)"), a sort dropdown, and a "Clear all" affordance. Selecting values narrows the table server-side; filters combine as **OR within a dimension, AND across dimensions**, and all combine with the title search and with the chosen sort. A new **Series** column appears in the table. When the active filter/search combination matches nothing, a filter-aware empty state explains the situation and offers one button that resets everything to the full library. All state is reflected in the URL and survives Prev/Next pagination and a page reload.

Verify by: applying any combination of filters + search + sort, paginating, reloading, and confirming the result set, the URL, and the controls stay in sync; and by confirming "Clear all" returns to the unfiltered, default-sorted full library.

## What We're NOT Doing

- **No filters beyond status, platform, genre, series.** Explicitly out: developer, release-year range, and `metadata_status` filtering.
- **No saved/named filter presets.** State is URL-only; no persistence of named filter combinations.
- **No smart/relevance default sort.** Sort is explicit (Date added / Title / Release year); algorithmic ordering is the S-07 recommender's job.
- **No `sessionStorage` rehydrate.** Persistence is URL params only — navigating to a bare `/library` link starts fresh (the "between pages" requirement is satisfied by pagination preserving params).
- **No client-side / instant filtering.** All filtering stays server-side; the filter controls trigger a full-page GET navigation (no fetch-on-change, no in-memory row filtering).
- **No change to the add-form platform behavior.** `list_used_platforms()` and the add/edit combobox (curated + used) are untouched; the filter facet is a separate, owned-only-with-counts source.

## Implementation Approach

Thread four new repeatable query params (`status`, `platform`, `genre`, `series`) plus a single `sort` param through the same path the S-05 search already uses: parse in `index.astro` → pass to `listLibraryEntries` → apply server-side in Supabase → preserve via `pageHref()`. Facet options + counts come from one new combined `library_facets()` RPC (one round trip, RLS-scoped) so the filter dropdowns only ever offer owned values. The filter/sort controls are a single presentational React island that composes the target URL and performs a full-page navigation on apply — keeping 100% of filtering server-side while giving multi-select + counts an ergonomic UI.

Filter combination semantics, locked:
- **Within a dimension** → OR. Scalar columns (`play_status`, `platform`) use `.in(col, values)`; array columns (`genre`, `series`) use `.overlaps(col, values)`.
- **Across dimensions** → AND (chained PostgREST conditions).
- **With title search** → AND (existing `ilike`).

Facet counts are computed against the **whole library**, independent of other active filters (stable, cheap, deterministic — no N-dimensional recomputation).

## Critical Implementation Details

- **Single filter chain.** Every filter must be added inside the `buildQuery` factory (`library.ts:179`), not in `fetchPage`, so the count query, the initial page fetch, and the out-of-bounds clamp re-fetch all apply identical filters — otherwise `total` and the clamped page diverge from the rendered rows.
- **Sort needs a stable tiebreaker.** Replacing the fixed `created_at desc` with a sort-driven `.order()` must keep a deterministic secondary order (e.g. `created_at desc` then, if needed, `id`) so pagination doesn't drop or duplicate rows across pages when the primary sort key ties (common for `release_year`).
- **Page reset on filter change.** Changing any filter/sort/search must navigate to `page=1`; preserving the old `page` can land the user on an out-of-bounds page (self-healed, but a jarring "Page 3 of 1" flash). `pageHref()` keeps `page` only for Prev/Next.

## Phase 1: Data & Facets

### Overview

Add the server-side facet source the filter dropdowns need (owned values + per-value counts for platform, genre, series, status) and the shared filter/sort vocabulary the service and page will share. No user-visible change yet.

### Changes Required:

#### 1. Combined facet RPC

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_library_facets_rpc.sql` (new; stamp the timestamp at author time per the naming convention)

**Intent**: Provide one RLS-scoped query that returns, for the current user's library, the distinct owned platforms, genres, and series and the present statuses — each with a match count — so filter dropdowns offer only values that can match and can show counts. One round trip rather than four.

**Contract**: A `SECURITY INVOKER`, `stable`, `set search_path = ''` function `public.library_facets()` returning a single `jsonb` object with four keys: `platforms`, `genres`, `series`, `statuses`, each an array of `{ "value": text, "count": int }`. Platform counts group by `trim(platform)`; genre/series **`unnest`** the `text[]` column before distinct/count and drop null/blank elements; statuses group by `play_status`. `platforms`/`genres`/`series` ordered by value; `statuses` may be returned in any order (the page zero-fills and orders them). `revoke all from public; grant execute to authenticated`. Mirror the existing `list_used_platforms` RPC's security/grant idiom.

#### 2. Shared filter + sort + facet types

**File**: `src/types.ts`

**Intent**: Define the sort vocabulary (keys, labels, and their column/direction mapping) and the facet/filter shapes once, so the service, the page, and the island can't drift on valid values.

**Contract**: Add (a) `LIBRARY_SORTS` — an ordered const of sort keys (`added_desc` default, `added_asc`, `title_asc`, `title_desc`, `year_desc`, `year_asc`) with user-facing labels and a `{ column, ascending }` mapping; `LibrarySort` = the key union, plus a `DEFAULT_LIBRARY_SORT = "added_desc"`. (b) `FacetValue = { value: string; count: number }` and `LibraryFacets = { platforms: FacetValue[]; genres: FacetValue[]; series: FacetValue[]; statuses: FacetValue[] }`. (c) `LibraryFilters = { statuses?: PlayStatus[]; platforms?: string[]; genres?: string[]; series?: string[] }`. Reuse the existing `PlayStatus` / `PLAY_STATUS_LABELS`.

#### 3. Regenerate DB types

**File**: `src/db/database.types.ts`

**Intent**: Pick up the new RPC so the service wrapper is typed.

**Contract**: Regenerate via the project's type-gen script (`npm run db:types`) after the migration applies; do not hand-edit. The `library_facets` function should appear under `public.Functions`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against a local Supabase (`npx supabase db reset` or equivalent)
- Calling `select public.library_facets();` as an authenticated user returns the four-key JSON shape (verified via SQL/PostgREST)
- DB types regenerated and `library_facets` present in `src/db/database.types.ts`
- Type checking + lint pass: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- For a seeded library, the facet counts match a hand count (e.g. a game with `genre = {RPG, Action}` increments both the RPG and Action genre counts)
- Genres/series with null or empty arrays contribute no facet rows and don't error

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Service Layer

### Overview

Extend `listLibraryEntries` to accept the four filter dimensions and the sort key, and add a typed wrapper for the facet RPC. After this phase the backend can produce any filtered + sorted page; nothing user-visible yet.

### Changes Required:

#### 1. Filtered + sorted listing

**File**: `src/lib/services/library.ts`

**Intent**: Apply status/platform/genre/series filters and the chosen sort inside the existing single-page query path, preserving the self-healing out-of-bounds behavior and the exact-count semantics.

**Contract**: Widen `listLibraryEntries`'s options to `{ page; pageSize; search?; statuses?: PlayStatus[]; platforms?: string[]; genres?: string[]; series?: string[]; sort?: LibrarySort }`. Inside `buildQuery`, after the existing `ilike` title filter, chain: `statuses?.length` → `.in("play_status", statuses)`; `platforms?.length` → `.in("platform", platforms)`; `genres?.length` → `.overlaps("genre", genres)`; `series?.length` → `.overlaps("series", series)`. In `fetchPage`, replace the fixed `.order("created_at", { ascending: false })` with the `LIBRARY_SORTS` mapping for the given `sort` (default `added_desc`), followed by a stable tiebreaker order. Empty/undefined arrays = no filter on that dimension. Keep the count-before-range ordering so `total` reflects the filtered set.

#### 2. Facet service wrapper

**File**: `src/lib/services/library.ts`

**Intent**: Wrap the `library_facets()` RPC behind a typed function returning `LibraryFacets`, matching the thin-wrapper style of `listUsedPlatforms`.

**Contract**: `getLibraryFacets(supabase): Promise<LibraryFacets>` — calls `supabase.rpc("library_facets")`, throws on error, returns the parsed object typed as `LibraryFacets`. (`list_used_platforms` / `listUsedPlatforms` stay unchanged — the add form still uses them.)

### Success Criteria:

#### Automated Verification:

- Type checking + lint pass: `npm run lint`
- Build passes: `npm run build`
- (If a service/unit test harness is present) a test exercising `listLibraryEntries` with combined filters + a non-default sort returns the expected rows and `total`

#### Manual Verification:

- Against a seeded library, a manual call with `{ statuses: ["not_played"], platforms: ["PlayStation 5"] }` returns only unplayed PS5 entries (AND across dimensions)
- A genre filter with two values returns entries matching *either* genre (OR within dimension via `overlaps`)
- Each sort option orders correctly and pagination across the sort is stable (no duplicated/dropped rows on tied keys)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Page & UI

### Overview

Parse the new params in the library page, wire them to the service and facet RPC, render the filter + sort control bar, add the Series column, surface facet counts, and make the empty state filter-aware with a single "Clear all". This is the user-visible phase.

### Changes Required:

#### 1. Parse filter/sort params + fetch facets

**File**: `src/pages/library/index.astro`

**Intent**: Read the four repeatable filter params and the sort param from the URL, validate them against the known vocabularies, pass them to `listLibraryEntries`, and load facets for the controls.

**Contract**: Use `Astro.url.searchParams.getAll("status"|"platform"|"genre"|"series")`, filtering statuses to `PLAY_STATUSES` and `sort` to `LIBRARY_SORTS` (fall back to `DEFAULT_LIBRARY_SORT`); pass platform/genre/series through verbatim. Thread these into both the initial `listLibraryEntries` call and the clamp re-fetch (lines 30–33 and 60–72). Add `getLibraryFacets(supabase)` to the parallel `Promise.all`, degrading to empty facets on its own failure (same pattern as `listUsedPlatforms.catch(() => [])`). Compute an `isFiltered` flag (any of search/status/platform/genre/series active or non-default sort).

#### 2. Preserve params across pagination; reset page on filter change

**File**: `src/pages/library/index.astro`

**Intent**: Keep filter/sort/search in the URL when paginating; reset to page 1 when filters change.

**Contract**: `pageHref()` already copies all params and swaps `page` — no change needed for Prev/Next. The filter island (below) composes its navigation URL *without* a `page` param (so it defaults to 1) while carrying `q` + the active filters + `sort`.

#### 3. Filter + sort control bar (island)

**File**: `src/components/library/LibraryFilters.tsx` (new) + mount in `src/pages/library/index.astro`

**Intent**: Render the search box, four multi-select filter popovers (with owned values + counts), a sort dropdown, and a clear-all; on apply, navigate (full-page GET) to the composed URL. Presentational only — no client-side row filtering.

**Contract**: Props: current `search`, current `filters` (selected values per dimension), current `sort`, and `facets: LibraryFacets`. Multi-select status/platform/genre/series via shadcn `Popover` + a checkbox/`Command` list (reuse the `PlatformCombobox` interaction pattern), each option labeled `"{value} ({count})"`; statuses rendered from the 5 canonical `PLAY_STATUS_LABELS`, zero-filled from `facets.statuses`. Sort via shadcn `Select` over `LIBRARY_SORTS` labels. On Apply, build a `URLSearchParams` with `q` + repeated `status`/`platform`/`genre`/`series` + `sort` (omit defaults/empties, omit `page`) and `window.location.assign("/library?…")`. A "Clear all" navigates to bare `/library`. This island replaces the inline native search `<form>` (lines 110–149); search input now lives inside it. Mount with `client:load`.

#### 4. Series column

**File**: `src/pages/library/index.astro`

**Intent**: Show series in the table alongside genre.

**Contract**: Add a "Series" `<th>` and a `<td>` rendering `entry.series?.length ? entry.series.join(", ") : "—"` (mirror the existing genre cell at line 227). Place it adjacent to the Genre column.

#### 5. Filter-aware empty state + clear-all

**File**: `src/pages/library/index.astro`

**Intent**: When any active filter/search excludes every row, explain it and offer one reset; keep the truly-empty-library state distinct.

**Contract**: Generalize the current `noMatches` condition (line 77, today keyed only on `query`) to fire when `total === 0 && !loadError && isFiltered`. Keep `isEmpty` for the zero-active-filters empty library (line 76). The no-match panel's copy becomes filter-aware (not just "match '{query}'") and its action is a "Clear all filters" link to `/library` (replacing the clear-search-only link at lines 185–190).

### Success Criteria:

#### Automated Verification:

- Type checking + lint pass: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Selecting status "Not played" + platform "PlayStation 5" shows only unplayed PS5 games; the URL reflects both params
- Selecting two genres shows entries matching either; adding a series filter further narrows (AND across, OR within)
- Each sort option reorders the table; default is newest-added-first
- Facet dropdowns show only owned values with correct counts; statuses show all five with counts
- Filters + sort + search persist across Prev/Next pagination and a full page reload
- Changing a filter resets to page 1
- A filter combination matching nothing shows the filter-aware empty state; "Clear all filters" returns to the full, default-sorted library
- The Series column renders values (joined) or "—"
- Works on a mobile-width viewport (controls usable, no horizontal overflow)

**Implementation Note**: After completing this phase and all automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `listLibraryEntries` with: single-dimension filter, multi-value within a dimension (OR), multiple dimensions (AND), filter + search combined, and each sort key (including tie stability across a page boundary).
- Param parsing: invalid `status`/`sort` values are ignored / fall back to default.

### Integration Tests:

- End-to-end (or page-level): apply filters via the control bar, confirm the URL and rendered rows; paginate and confirm preservation; clear-all returns to full library.

### Manual Testing Steps:

1. Seed a library spanning ≥2 platforms, ≥2 statuses, multiple genres/series, enough entries to paginate (>20).
2. Apply "Not played" + a platform; confirm rows + URL; page Next/Prev; reload — state holds.
3. Select two genres; confirm OR-within behavior; add a series filter; confirm further narrowing.
4. Cycle every sort option; verify ordering and stable pagination on a tied key (e.g. shared `release_year`).
5. Build a no-match combination; verify filter-aware empty state and "Clear all".
6. Repeat key steps on a mobile-width viewport.

## Performance Considerations

Filtering and sorting run in Postgres over a small (target ~50+) per-user, RLS-scoped table — well within latency budgets. The combined `library_facets()` RPC is one round trip; counts are whole-library and not recomputed per active filter. Existing per-user indexing supports the platform DISTINCT; genre/series `unnest` over a small table is cheap. No new hot path.

## Migration Notes

One additive, read-only migration (the `library_facets` RPC). No schema/column changes, no data backfill, no destructive operations — `genre`/`series` are already `text[]`. Rollback is dropping the function; the page/service degrade to "no facet options" if the RPC is absent (handled by the `.catch` on the facet fetch), so deploy order is forgiving.

## References

- Roadmap slice: `context/foundation/roadmap.md` → S-06 (`filter-and-sort-library`)
- PRD: US-05, FR-019 (`context/foundation/prd.md:98`, `:146`)
- Search seam to extend: `src/pages/library/index.astro:85` (`pageHref`), `:110–149` (search form)
- Service filter factory: `src/lib/services/library.ts:179` (`buildQuery`)
- Facet RPC precedent: `supabase/migrations/20260611120000_list_used_platforms_rpc.sql`, `src/lib/services/library.ts:223`
- Array columns: `supabase/migrations/20260608183408_enrich_library_entries_metadata.sql`
- Status vocabulary: `src/types.ts:25–36`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data & Facets

#### Automated

- [x] 1.1 Migration applies cleanly against a local Supabase — 04b1d1c
- [x] 1.2 `select public.library_facets();` returns the four-key JSON shape for an authenticated user — 04b1d1c
- [x] 1.3 DB types regenerated and `library_facets` present in `src/db/database.types.ts` — 04b1d1c
- [x] 1.4 Type checking + lint pass: `npm run lint` — 04b1d1c
- [x] 1.5 Build passes: `npm run build` — 04b1d1c

#### Manual

- [x] 1.6 Facet counts match a hand count on a seeded library (multi-genre game increments each genre) — 04b1d1c
- [x] 1.7 Null/empty genre/series arrays contribute no facet rows and don't error — 04b1d1c

### Phase 2: Service Layer

#### Automated

- [x] 2.1 Type checking + lint pass: `npm run lint`
- [x] 2.2 Build passes: `npm run build`
- [x] 2.3 (If a test harness is present) combined-filter + non-default-sort test returns expected rows and `total`

#### Manual

- [x] 2.4 `{ statuses: ["not_played"], platforms: ["PlayStation 5"] }` returns only unplayed PS5 entries (AND across)
- [x] 2.5 Two-value genre filter returns entries matching either genre (OR within, via `overlaps`)
- [x] 2.6 Each sort option orders correctly; pagination stable on tied keys

### Phase 3: Page & UI

#### Automated

- [ ] 3.1 Type checking + lint pass: `npm run lint`
- [ ] 3.2 Build passes: `npm run build`

#### Manual

- [ ] 3.3 Status + platform filter shows only matching rows; URL reflects both params
- [ ] 3.4 Two genres → OR; adding series → further AND narrowing
- [ ] 3.5 Each sort option reorders; default is newest-added-first
- [ ] 3.6 Facet dropdowns show only owned values with correct counts; statuses show all five
- [ ] 3.7 Filters + sort + search persist across pagination and a full reload
- [ ] 3.8 Changing a filter resets to page 1
- [ ] 3.9 No-match combination shows filter-aware empty state; "Clear all filters" returns to full library
- [ ] 3.10 Series column renders joined values or "—"
- [ ] 3.11 Usable on a mobile-width viewport (no horizontal overflow)
