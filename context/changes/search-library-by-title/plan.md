# Search the Library by Title — Implementation Plan

## Overview

Add case-insensitive **title-substring** search to the existing server-rendered library browse view. The user types a fragment of a game title, submits, and the list re-renders showing only entries whose title contains that fragment (case-insensitive) — the fast "do I already own this?" check that fulfils the PRD's **secondary** success criterion (in-store / marketplace duplicate-purchase avoidance).

This is roadmap slice **S-05** (`search-library-by-title`), Stream A. PRD refs: **US-05**, **FR-012**. Prerequisites F-01 and S-01 are both done.

## Current State Analysis

The library browse view is fully SSR with URL-param navigation — there is no client island and no GET list endpoint:

- **Page** `src/pages/library/index.astro:13` parses `?page=N`, then calls `listLibraryEntries(supabase, { page, pageSize: 20 })` server-side (`:27-30`) and renders a table. Pagination is plain anchor links built inline as `` `/library?page=${effectivePage ± 1}` `` (`:164`, `:184`).
- **Service** `src/lib/services/library.ts:148-166` runs one query: `.select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, to)`, returning `{ entries, total }`. Per-user isolation is enforced by RLS, never by an explicit `user_id` filter.
- **Two empty/degraded states already exist**: a load-error banner (`index.astro:92-98`, gated on `loadError`) and a "Your library is empty" card (`:100-115`, gated on `isEmpty = total === 0 && !loadError`).
- **Per-row islands** (`PlayStatusControl`, `EntryRowActions`, both `client:visible`) operate on whatever rows the page renders — unaffected by filtering.
- **Page-clamp logic** (`:56-65`) re-fetches the last valid page when the requested page is out of bounds (e.g. after a deletion). Any search must feed its filtered `total` into this same clamp so it keeps working over the matched set.

### Key Discoveries:

- The service is already an **options object**, so adding an optional `search` key is non-breaking and the `{ entries, total }` return contract every consumer depends on never moves — `src/lib/services/library.ts:148-151`.
- Supabase PostgREST exposes `.ilike(column, pattern)` for case-insensitive `LIKE`; the user's input must have LIKE wildcards (`%`, `_`) and the PostgREST reserved `,`/`*`/`(`/`)` escaped before being wrapped in `%…%`, or a title containing `%` would match too broadly.
- A reusable case-insensitive idiom and trim/normalize convention already exist in the codebase: `PlatformCombobox.tsx:33-36` and the page's own dedupe at `index.astro:40-48`.
- The pagination anchors are built in **two** places (prev `:164`, next `:184`); a small shared helper that preserves the current query params is the seam S-06 will later extend to thread `status`/`platform`/`genre`/`sort`.
- This slice is **title-only by design** — the roadmap split S-05 from S-06 (filter & sort by status/platform/genre, session persistence). See `context/foundation/roadmap.md` S-05/S-06.

## Desired End State

A signed-in user on `/library` sees a search box above the table. Typing `zelda` (or `ZELDA`) and submitting navigates to `/library?q=zelda`, and the table shows only entries whose title contains "zelda" (case-insensitive), paginated 20-per-page with the `total` reflecting the match count. Page links preserve `q`. A new search resets to page 1. A visible **Clear** control returns to the full, unfiltered library. When nothing matches, the user sees an explanatory "No games match '…'" state with the search box still populated and a Clear affordance — not the empty-library card and not a bare table.

**Verification**: `npm run lint` and `npm run build` pass; searching a known title substring filters the list case-insensitively; pagination over a filtered set works; clearing restores the full library; a non-matching query shows the dedicated no-match state.

## What We're NOT Doing

- **No filter or sort by status / platform / genre, and no sort controls** — that is S-06. We only leave additive seams for it.
- **No live / debounced keystroke search, no client-side island, no new GET API endpoint** — search stays SSR via URL param, consistent with the existing `?page=N` navigation.
- **No search over fields other than `title`** (not platform, genre, developer, series).
- **No session-persistence machinery beyond the URL itself** — URL params already make state shareable/bookmarkable; the formal "filter/sort state preserved within a session" criterion is S-06's.
- **No changes to the per-row islands, the add/edit dialog, or any write path.**
- **No fuzzy / typo-tolerant matching, no relevance ranking** — plain substring, ordered newest-first like the existing browse.

## Implementation Approach

Thread one optional `search` parameter from the URL (`?q=`) → page → service, where it becomes a single escaped `.ilike("title", "%…%")` clause inserted before the existing `.order()`/`.range()`. The page parses and trims `q`, passes it down, and uses the returned filtered `total` in the existing clamp/pagination math unchanged. The UI adds a GET `<form>` search box in a small browse-controls row, a shared param-preserving page-link helper, a Clear control, and a third empty-state branch for "searched but no matches." Everything else on the page is untouched.

## Critical Implementation Details

- **LIKE-wildcard + PostgREST escaping**: the raw user query must be sanitized before interpolation into the `%…%` pattern, or characters like `%`, `_`, and PostgREST's pattern-list delimiters (`,`, `(`, `)`, `*`) change the match semantics. Escape `%`→`\%`, `_`→`\_` (PostgREST `ilike` honours backslash escapes), and avoid passing unescaped commas into the filter value. Keep this in the service so every caller is protected.
- **Empty / whitespace-only `q` must behave as "no search"**: after `trim()`, an empty string means render the full library (do **not** emit an `.ilike("%%")` that is technically a full scan with different `total` semantics — just skip the filter). This is also what makes "Clear" work by navigating to `/library` with no `q`.
- **The page-clamp at `index.astro:56-65` must use the filtered total**: when `q` is present, `listLibraryEntries` returns the match `total`; the existing `totalPages`/`effectivePage` clamp and the out-of-bounds re-fetch must run against that filtered total so deep-linking `/library?q=zelda&page=9` clamps correctly.

## Phase 1: Backend title filter

### Overview

Extend the service query to apply an optional case-insensitive title filter, and parse/sanitize the `?q=` param in the page. After this phase the filter works end-to-end via hand-typed URLs, before any UI exists.

### Changes Required:

#### 1. Library service — optional `search` on `listLibraryEntries`

**File**: `src/lib/services/library.ts`

**Intent**: Add an optional `search` to the options object so the list query can filter entries by case-insensitive title substring while preserving pagination, the `{ entries, total }` contract, and RLS isolation. A blank/whitespace `search` is treated as no filter.

**Contract**: `listLibraryEntries(supabase, { page, pageSize, search }: { page: number; pageSize: number; search?: string })` → unchanged `Promise<{ entries: LibraryEntry[]; total: number }>`. When `search?.trim()` is non-empty, insert `.ilike("title", \`%${escaped}%\`)` **before** `.order(...).range(...)` so `count: "exact"` reflects the filtered total. Add a private helper that escapes LIKE/PostgREST-significant characters (`%`, `_`, and backslash) in the user term. Update the JSDoc to note the optional title filter.

#### 2. Library page — parse and pass `q`

**File**: `src/pages/library/index.astro`

**Intent**: Read the `q` search param from the URL, trim it, and pass it to `listLibraryEntries` (both the initial fetch and the out-of-bounds clamp re-fetch) so the rendered list and `total` reflect the search.

**Contract**: Parse `const rawQuery = Astro.url.searchParams.get("q") ?? ""` and `const query = rawQuery.trim()`. Pass `search: query || undefined` into both `listLibraryEntries(...)` calls (`:28` and `:59`). No change to the clamp math — it consumes the returned `total` as-is.

### Success Criteria:

#### Automated Verification:

- Type checking / lint passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- Visiting `/library?q=<substring of an owned title>` shows only matching entries; the count header and pagination reflect the filtered total.
- Search is case-insensitive: `?q=ZELDA` and `?q=zelda` return the same matches.
- `/library?q=` (empty) and `/library` render the identical full library.
- A title containing a literal `%` or `_` is not over-matched by a query of that character (escaping works).
- Deep-linking `/library?q=<term>&page=99` clamps to the last valid page of the filtered set, not a blank table.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2. Phase blocks use plain bullets — the `- [ ]` checkboxes live in `## Progress`.

---

## Phase 2: Search UI, pagination threading, and no-match state

### Overview

Add the visible search box, make pagination preserve the `q` param, add a Clear control, and render a dedicated empty state when a search matches nothing. This is the user-facing half and the only place that introduces seams S-06 will reuse.

### Changes Required:

#### 1. Browse-controls row with the search form

**File**: `src/pages/library/index.astro`

**Intent**: Add a small controls row above the table containing a `GET` search form whose submission navigates to `/library?q=…` (resetting pagination by omitting `page`). The input is prefilled with the current `query` so the term persists across the navigation. This row is the container S-06 will later drop its filter/sort controls into.

**Contract**: `<form method="get" action="/library">` with a single named text input `name="q"` (value=`query`), a submit button, and — when `query` is non-empty — a Clear control that links to `/library` (no params). Place it inside the existing `max-w-5xl` container, between the header (`:79-90`) and the conditional content blocks. Show the search form whenever the library is non-empty (i.e. not the first-game empty state). Follow the existing Tailwind/glass styling idiom used on the page.

#### 2. Param-preserving pagination links

**File**: `src/pages/library/index.astro`

**Intent**: Replace the two hardcoded `` `/library?page=${n}` `` hrefs with a helper that builds a page URL preserving the current `q` (and any future params), so paging through search results keeps the filter. This helper is the seam S-06 extends to thread `status`/`platform`/`genre`/`sort`.

**Contract**: A local function `pageHref(targetPage: number): string` that clones `Astro.url.searchParams`, sets `page`, and returns `` `/library?${params}` ``. Use it at the prev (`:164`) and next (`:184`) anchors. Build it generically (copy existing params) rather than hardcoding only `q`.

#### 3. Dedicated no-match empty state

**File**: `src/pages/library/index.astro`

**Intent**: When a search is active but returns nothing, show an explanatory state ("No games match '…'") with a Clear affordance — distinct from the existing empty-library card and load-error banner — satisfying US-05's "explanatory empty-state, not a broken list." Word/structure it so S-06 can later widen the copy to "No games match your filters."

**Contract**: Introduce a derived flag, e.g. `const noMatches = total === 0 && !loadError && query.length > 0`, and gate the existing `isEmpty` on no active query (`total === 0 && !loadError && query.length === 0`). Render the no-match branch when `noMatches` is true: a message echoing the `query` and a Clear link to `/library`. Keep the search form visible above it.

### Success Criteria:

#### Automated Verification:

- Type checking / lint passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- The search box appears above the table on a populated library; typing a term and submitting filters the list.
- The search input stays populated with the submitted term after navigation.
- Paginating a filtered result (Previous/Next) preserves the `q` term and pages correctly over the matched set.
- A new search resets to page 1.
- Clicking Clear returns to the full, unfiltered library.
- A query with no matches shows the dedicated "No games match '…'" state (not the empty-library card, not a bare table), with the search box still populated and a working Clear control.
- The first-run empty-library card still shows correctly when the library is genuinely empty (no `q`).
- Per-row controls (play status, edit, delete) still work on a filtered list.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that manual testing succeeded.

---

## Testing Strategy

### Manual Testing Steps:

1. With a library of several games, search a substring shared by 2+ titles → only those appear; count + pagination reflect the filtered total.
2. Search the same term in different cases → identical results (case-insensitive).
3. Search a term matching nothing → dedicated no-match state with populated box + Clear.
4. Clear (button and by navigating to `/library`) → full library restored.
5. Filter down to >20 matches and page through → `q` preserved, paging correct, page 1 on new search.
6. Deep-link `/library?q=<term>&page=<too-high>` → clamps to last valid filtered page.
7. Edge: search a title containing `%` / `_` with a literal-character query → no over-matching.
8. Regression: genuinely empty library (no `q`) still shows "Your library is empty"; load-error path unaffected; per-row islands still function on filtered rows.

## Performance Considerations

Single-user, small data (50+ entries; PRD `target_scale: small`). `ilike "%term%"` is a sequential scan but trivial at this volume; no index needed. The query keeps `count: "exact"` and `.range()`, so cost stays bounded by page size, identical to today's browse.

## Migration Notes

None — no schema change, no migration, no new dependency. Purely a query parameter, a page-side param, and UI.

## References

- Roadmap slice S-05: `context/foundation/roadmap.md` (S-05 vs S-06 split)
- PRD: US-05 (`prd.md:98-109`), FR-012 (`prd.md:144-145`), secondary success criterion (`prd.md:39-40`)
- Service to extend: `src/lib/services/library.ts:148-166`
- Page to extend: `src/pages/library/index.astro` (fetch `:27-30`, clamp `:56-65`, pagination anchors `:164`/`:184`, empty states `:92-115`)
- Case-insensitive idiom precedent: `src/components/library/PlatformCombobox.tsx:33-36`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend title filter

#### Automated

- [x] 1.1 Type checking / lint passes: `npm run lint`
- [x] 1.2 Production build passes: `npm run build`

#### Manual

- [x] 1.3 `/library?q=<substring>` shows only matching entries; count + pagination reflect filtered total
- [x] 1.4 Search is case-insensitive (`?q=ZELDA` == `?q=zelda`)
- [x] 1.5 `/library?q=` and `/library` render the identical full library
- [x] 1.6 Literal `%`/`_` in a title is not over-matched (escaping works)
- [x] 1.7 `/library?q=<term>&page=99` clamps to last valid filtered page

### Phase 2: Search UI, pagination threading, and no-match state

#### Automated

- [ ] 2.1 Type checking / lint passes: `npm run lint`
- [ ] 2.2 Production build passes: `npm run build`

#### Manual

- [ ] 2.3 Search box appears on a populated library; submitting filters the list
- [ ] 2.4 Search input stays populated with the submitted term after navigation
- [ ] 2.5 Paginating a filtered result preserves `q` and pages correctly
- [ ] 2.6 A new search resets to page 1
- [ ] 2.7 Clear returns to the full, unfiltered library
- [ ] 2.8 No-match query shows the dedicated state (not empty-library card, not bare table) with populated box + Clear
- [ ] 2.9 Genuinely empty library (no `q`) still shows "Your library is empty"
- [ ] 2.10 Per-row controls (status/edit/delete) still work on a filtered list
