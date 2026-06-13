# Search the Library by Title — Plan Brief

> Full plan: `context/changes/search-library-by-title/plan.md`

## What & Why

Add case-insensitive **title-substring** search to the library browse view. This fulfils the PRD's secondary success criterion: the user can check "do I already own this?" before buying a game in a store or online (US-05, FR-012). It's roadmap slice **S-05** — deliberately split from filter/sort (S-06) because it has independent product value and depends only on a populated library.

## Starting Point

The library at `/library` is fully server-rendered: `library/index.astro` parses `?page=N`, calls `listLibraryEntries(supabase, { page, pageSize: 20 })`, and renders a paginated table with plain anchor pagination links. There is no client-side island for browsing and no GET list endpoint. Two empty/degraded states already exist (load-error banner; "library is empty" card). Per-user isolation is via RLS.

## Desired End State

Above the table sits a search box. Submitting a term navigates to `/library?q=<term>` and the table shows only entries whose title contains it (case-insensitive), paginated, with `total` reflecting the match count. Page links preserve `q`; a new search resets to page 1; a visible **Clear** restores the full library. A non-matching query shows an explanatory "No games match '…'" state — not the empty-library card, not a bare table.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Submission model | SSR via `?q=` URL param | Matches the existing `?page=N` pattern; URL params are the natural carrier for S-06's combinable filters, so S-06 stays additive. | Plan |
| S-06 readiness | Minimal extensible seams only | Optional `search` key, a param-preserving page-link helper, and a controls row — no speculative filter abstractions. | Plan |
| No-match UX | Dedicated explanatory state + Clear | Satisfies US-05's "explanatory empty-state, not a broken list"; structured so S-06 can widen the copy. | Plan |
| Paging & clear | `q` persists in page links; new search → page 1; explicit Clear | Correct paging over the matched set; mirrors current `?page` behaviour. | Plan |
| Scope | Title substring only | Honours the roadmap's S-05/S-06 split; ships the whole secondary criterion with nothing blocking it. | Roadmap |

## Scope

**In scope:** Case-insensitive title-substring search via `?q=`; filtered pagination; Clear control; dedicated no-match state; the seams (optional service param, param-preserving link helper, controls row) S-06 will reuse.

**Out of scope:** Filter/sort by status/platform/genre (S-06); live/debounced search; any new client island or GET endpoint; searching non-title fields; fuzzy matching or ranking; schema/migration changes.

## Architecture / Approach

Thread one optional `search` param: URL `?q=` → page (`index.astro`) → service (`listLibraryEntries`), where it becomes a single escaped `.ilike("title", "%…%")` clause inserted before the existing `.order()/.range()`, keeping `count:"exact"` so `total` reflects matches. The page feeds the filtered `total` into its existing pagination/clamp math unchanged. UI adds a GET `<form>` search box, a shared `pageHref()` helper that preserves query params, a Clear link, and a third empty-state branch.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend title filter | Optional `search` on `listLibraryEntries` (escaped `.ilike`) + `?q=` parsed in the page; works via hand-typed URLs | LIKE-wildcard/PostgREST escaping done wrong → over-matching |
| 2. Search UI + paging + no-match | Search form, param-preserving pagination, Clear control, dedicated no-match state | Empty-state branching collides with the two existing states |

**Prerequisites:** F-01 (library store) and S-01 (browse view) — both done.
**Estimated effort:** ~1 short session across 2 phases.

## Open Risks & Assumptions

- Assumes `ilike "%term%"` is acceptable at PRD `target_scale: small` (50+ entries, single user) — no index added; true sequential scan but trivial at this volume.
- Whitespace-only `q` must degrade to "no search" (skip the filter), not an `.ilike("%%")` — handled in the service.
- The out-of-bounds page-clamp must run against the *filtered* total so deep links clamp correctly.

## Success Criteria (Summary)

- A user can type a title fragment (any case) and see only matching games; pagination and count reflect the filtered set.
- Clearing the search (button or `/library`) returns the full library; a non-matching query shows an explanatory no-match state.
- No regression to the genuinely-empty-library card, the load-error path, or per-row controls.
