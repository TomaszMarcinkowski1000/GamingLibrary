# Filter and Sort the Library — Plan Brief

> Full plan: `context/changes/filter-and-sort-library/plan.md`

## What & Why

Give the collector a practical way to browse a 50+ game shelf: filter the library by **status, platform, genre, and series** (multi-select, combinable) and **sort** it, all combinable with the existing title search. At that size, "show me unplayed PS5" is the only sane browse pattern — FR-019 / US-05 exist precisely because scrolling the whole list doesn't scale.

## Starting Point

The library browse (`src/pages/library/index.astro`) is fully server-rendered and URL-param-driven; the S-05 title search already established the pattern — `?q` parsed server-side, filtered in Supabase via `listLibraryEntries`, with `pageHref()` preserving params across pagination. There is no client-side filtering. `genre` and `series` are already `text[]` IGDB fields; `play_status` is a 5-value enum; `platform` is single text. A `list_used_platforms()` facet RPC exists, but nothing returns genre/series facets or counts.

## Desired End State

Above the table sits a control bar: title search, four multi-select filter popovers showing owned values with match counts (e.g. "PlayStation 5 (12)"), a sort dropdown, and "Clear all". Filters combine OR-within-dimension, AND-across, and AND with search. A new **Series** column joins the table. A filter-aware empty state offers one reset when nothing matches. All state is in the URL and survives pagination and reload.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Selection mode | Multi-select per filter (OR within, AND across) | More expressive browsing across platforms/genres | Plan |
| Interaction | Server round-trip via GET navigation (no client filtering) | Mirrors S-05, state in URL for free, one code path | Plan |
| Sort options | Title / Date added / Release year; default newest-added | Natural browse axes from on-row data; default = current behavior | Plan |
| Facet source | Owned values only, with per-value counts | No dead options; discoverable; matches platform-facet precedent | Plan |
| Persistence | URL params only | Zero extra state, shareable, survives reload + pagination | Plan |
| Empty state | Filter-aware panel + single "Clear all" | Satisfies "clear filters → full library"; reuses no-match panel | Plan |
| Series filter/column | Added beyond FR-019's three | Already a `text[]` field — near-zero marginal cost | Plan (user) |
| Facet counts | In scope (whole-library, not recomputed per filter) | User left it in scope; stable + cheap | Plan (user) |

## Scope

**In scope:** multi-select filters (status, platform, genre, series); sort (title/date-added/year); facet dropdowns with owned values + counts; Series list column; filter-aware empty state + clear-all; URL-param persistence across pagination/reload.

**Out of scope:** developer / year-range / metadata_status filters; saved filter presets; smart/relevance default sort; sessionStorage rehydrate; client-side/instant filtering; changes to the add-form platform combobox.

## Architecture / Approach

Four repeatable params (`status`/`platform`/`genre`/`series`) + one `sort` param flow through the S-05 path: parsed in `index.astro` → passed to `listLibraryEntries` → applied server-side in Supabase → preserved by `pageHref()`. Scalar columns filter with `.in()`, array columns (`genre`/`series`) with `.overlaps()` (OR-within). Facet options + counts come from one combined, RLS-scoped `library_facets()` RPC. The control bar is a single presentational React island that composes a URL and does a full-page GET navigation on apply — filtering stays 100% server-side.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data & Facets | `library_facets()` RPC + shared filter/sort/facet types | `unnest` distinct/count over `text[]` correctness; regen DB types |
| 2. Service Layer | `listLibraryEntries` filters + sort; `getLibraryFacets` wrapper | Filters must live in `buildQuery` so count/clamp/page stay consistent; stable sort tiebreaker |
| 3. Page & UI | Param parsing, filter+sort control island, Series column, facet counts, filter-aware empty state | Multi-select-in-GET UX; page-reset on filter change; mobile layout |

**Prerequisites:** F-01, S-01, S-04 (all done). Local Supabase for the migration; existing IGDB-enriched entries to exercise genre/series.
**Estimated effort:** ~2–3 sessions across the three phases.

## Open Risks & Assumptions

- Multi-select inside a server GET flow is delivered via a navigation-on-apply island; if a no-JS pure-HTML form is required instead, the control bar needs rework (status/platform as checkboxes, genre/series less ergonomic).
- Facet counts are whole-library, not recomputed against other active filters — assumed acceptable (stated decision).
- Sort on nullable `release_year` needs a defined null-ordering + stable tiebreaker to keep pagination correct.

## Success Criteria (Summary)

- The collector can combine status/platform/genre/series filters with search and a chosen sort and see exactly the matching subset, server-filtered.
- Filter/sort/search state survives pagination and reload via the URL; "Clear all" returns to the full library.
- Filter dropdowns offer only owned values with accurate match counts; the Series column is visible.
