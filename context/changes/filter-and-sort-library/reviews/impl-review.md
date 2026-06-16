<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Filter and Sort the Library

- **Plan**: context/changes/filter-and-sort-library/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-06-16
- **Verdict**: APPROVED
- **Findings**: 0 critical 0 warnings 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated Verification

- `npm run lint` — PASS (no errors; only pre-existing astro-eslint-parser notices)
- `npm run test` — PASS (55 tests, incl. 13 in src/lib/services/library.test.ts)
- `npm run build` — PASS (server built in 7.8s)

All 11 Phase-3 manual criteria checked `[x]` in Progress (c69ac1e); Phase 1–2 manual items checked (04b1d1c / b4f23e6). Diff confirms the controls island, Series column, and filter-aware empty state exist — manual checks substantiated, not rubber-stamped.

## Findings

### F1 — Sort tiebreaker stops at created_at, not id

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/library.ts:244-246
- **Detail**: The plan's Critical Implementation Detail #2 specified a secondary order of "created_at desc then, if needed, id" so tied primary keys (common for release_year) don't shuffle rows across page boundaries. The implementation adds `created_at desc` as the tiebreaker but stops there — no final `id`. created_at is high-precision timestamptz, so two rows colliding on BOTH release_year and created_at is unlikely in normal single-insert flow but possible under batch insert/seed. The plan said "if needed," so this is within intent — the one residual gap against the locked detail.
- **Fix**: Append `.order("id")` after the created_at tiebreaker in fetchPage so ordering is fully deterministic on any tie.
- **Decision**: FIXED

### F2 — Filter-value count from getAll() is uncapped

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/library/index.astro:28-30
- **Detail**: platform/genre/series are read via getAll() and passed verbatim into .in()/.overlaps() with no cap on the number of repeated params. Values are parameterized by PostgREST (no injection), and the route is behind auth, so this is at most a mild query-amplification vector — not a real vulnerability. Noted for completeness, not action-required.
- **Fix**: Optional — slice each filter array to a sane bound (e.g. 50) during parsing if you want belt-and-suspenders hardening.
- **Decision**: SKIPPED

## Triage (2026-06-16)

- **F1 — FIXED**: Appended `.order("id")` after the created_at tiebreaker in `fetchPage` (src/lib/services/library.ts) for fully deterministic ordering on any tie. Updated `library.test.ts` (chainable `order` mock + two `calls.order` assertions). All 55 tests pass.
- **F2 — SKIPPED**: No real vulnerability (parameterized + behind auth); left as-is.

## Notes

Both review passes found all 15 planned contract items as MATCH — no drift, no missing work, no forbidden scope creep. The only EXTRAs (hiding empty-facet popovers, per-dimension clear buttons) are degradable UI polish within the plan's intent. The RPC mirrors the `list_used_platforms` precedent (SECURITY INVOKER under RLS, `search_path = ''`, revoke/grant); queries stay parameterized; output auto-escapes; migration is additive/read-only. Both findings are LOW-impact observations; neither blocks approval.
