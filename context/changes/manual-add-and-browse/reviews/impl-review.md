<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Manual Add & Browse (S-01)

- **Plan**: context/changes/manual-add-and-browse/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-06-11
- **Verdict**: APPROVED
- **Findings**: 0 critical · 2 warnings · 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated gate re-run during review: `npm run typecheck` (0 errors), `npm run lint` (clean — only upstream parser deprecation warnings), `npm test` (6/6 pass), `npm run build` (succeeds).

## Findings

### F1 — listUsedPlatforms does an unbounded full-table scan on every page load

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/lib/services/library.ts:120-139
- **Detail**: Selects every `platform` value for the user with no limit, then dedupes in JS. Runs on every page render including paginated views (page 2+) where combobox options are redundant. Grows linearly with library size. Fine at the targeted single-collector / few-hundred-entry scale, but uncapped.
- **Fix**: Add `.limit(1000)` to the select as a cheap guard (longer-term: push DISTINCT down to Postgres via RPC/view).
- **Decision**: FIXED (via approach A — pushed DISTINCT down to Postgres). Added `security invoker` RPC `public.list_used_platforms()` (migration `20260611120000_list_used_platforms_rpc.sql`, applied to local DB), registered it in `database.types.ts`, and replaced the JS scan+dedupe in `library.ts` with `supabase.rpc("list_used_platforms")`. Gates: typecheck/lint/test/build all green.

### F2 — Promise.all couples a non-critical query to the whole page's load success

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/library/index.astro:23-26
- **Detail**: listLibraryEntries and listUsedPlatforms run in one Promise.all inside a single try/catch. If the non-critical platform-options query fails or is slow, the whole page renders the loadError state even when the entries list would have succeeded. Both hit the same table (so a failure of one usually means both), which is why it's acceptable for MVP — but the combobox options are a degradable nicety, not a reason to blank the library.
- **Fix**: Fetch listUsedPlatforms with its own catch that degrades to `[]` (or derive options from the rendered entries), so only a true entries-query failure triggers loadError.
- **Decision**: FIXED. Wrapped `listUsedPlatforms(supabase)` in `.catch(() => [] as string[])` inside the `Promise.all` (src/pages/library/index.astro), keeping both queries concurrent but isolating the non-critical platform-options failure from `loadError`. Gates: typecheck/lint green.

### F3 — "No metadata" label triggers on any non-matched status, broader than plan

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/library/index.astro:51-53, 117-121
- **Detail**: Plan said show the indicator when `metadata_status === 'no_match'`. Implementation shows it for any non-'matched' value (including null). Given `metadata_status` is nullable, this is arguably more correct than the plan's literal — null would otherwise render no indicator. Intentional, benign widening, not a defect.
- **Fix**: None needed. Optionally update the plan note to match if exactness is wanted.
- **Decision**: ACCEPTED as-is. Widening to "any non-matched status" is intentional and arguably more correct given `metadata_status` is nullable; no code or plan change made.

## Notes

- Every one of the 10 planned changes is a clean MATCH — no missing work, no contract-violating drift.
- Security model verified: 401 auth boundary + RLS tenant isolation, zod-validated input, Astro auto-escaping, no `set:html`.
- Load-bearing reliability contract verified: enrichment throws folded into `no_match` save (src/lib/services/library.ts:55-72), test-covered.
- Scope extras all justified within contracts: vitest infra (vitest.config.ts, test/stubs/astro-env-server.ts), popover `container` portal fix in PlatformCombobox, `triggerLabel`/`triggerSize` for empty-state CTA, JSON-parse 400 guard, `savedSinceOpen` refresh-on-close.
