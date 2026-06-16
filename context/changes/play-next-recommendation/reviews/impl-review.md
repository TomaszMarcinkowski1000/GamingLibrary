<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: "What should I play next?" Recommendation

- **Plan**: context/changes/play-next-recommendation/plan.md
- **Scope**: Phase 1 & 2 (full plan)
- **Date**: 2026-06-16
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated success criteria all green: `npm run typecheck` (0 errors), `npm run lint` (warnings only, no errors), `npm run build` (server build complete), `npm test` (88 tests pass — 30 in recommendation.test.ts, 13 in validation/library.test.ts).

## Notes on what came up clean

- **Determinism (core PRD requirement)** — verified airtight: no `Math.random`/`Date.now`/`new Date()` in the scoring path; final sort is total-order and stable down to unique `id` (score desc → `created_at` asc → `id` asc); rank-normalization is tie-deterministic; numeric/date sorts use proper comparators, not default string coercion. A test reverses input and asserts identical output.
- **`?show=all` toggle and "Bought" column are not scope creep** — the plan explicitly carved out `?show=all` as an inspection aid (plan.md:48). Comma-split length parsing is a harmless superset of the parser contract.
- **All 7 planned files MATCH intent**, no MISSING items, existing service functions untouched.
- **Security/authz/XSS** all clean: RLS-scoped query, no user input reaches queries, Astro auto-escaping on rendered titles/platforms, `/play-next` in `PROTECTED_ROUTES`.
- Untracked `scripts/seed-play-next.sql` is a manual-test seed, never committed — outside the reviewed diff.

## Findings

### F1 — listAllEntries is an unbounded full-table fetch per request

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/library.ts:229-235 (+ src/pages/play-next/index.astro:29 passes Number.MAX_SAFE_INTEGER)
- **Detail**: `listAllEntries` selects every row for the user with no `.limit()` and no cap. The page calls `getRecommendations` with `Number.MAX_SAFE_INTEGER` for the `?show=all` path, so the full ranked set is materialized and rendered. This is the intended v1 design (rank whole library in memory) and is fine at PRD personal-library scale — read-only, RLS-scoped. But there is no ceiling: a pathologically large library pulls all rows into the Worker on every `/play-next` load. The column comment claims it stays "cheap as the library grows," which holds for row width, not row count.
- **Fix**: Add a defensive hard cap — `.limit(5000)` (or similar) on the `listAllEntries` query as a guardrail. Optional: also clamp the `?show=all` render count. One-line change, no behavior impact at real scale.
- **Decision**: FIXED — added `RECOMMENDATION_MAX_ROWS = 5000` cap via `.limit()` on the `listAllEntries` query (src/lib/services/library.ts).

### F2 — Per-row "link to library" replaced by a single header back-link

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/play-next/index.astro:82-87, 181-199
- **Detail**: The Phase 2 contract said each ranked item shows a "link to library for acting on it." The implementation renders one "← Back to library" header link instead of a per-row link. Navigation intent is covered; this is a reasonable simplification, not a gap. Noted only so the divergence is on record.
- **Fix**: None required. Add per-row links only if acting-on-a-result from this page proves clunky in real use.
- **Decision**: SKIPPED — accepted as-is; header back-link covers navigation intent, per-row links deferred until proven clunky.
