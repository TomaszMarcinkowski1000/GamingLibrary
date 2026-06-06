<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Library-entry store

- **Plan**: context/changes/library-entry-store/plan.md
- **Scope**: Phase 1+2 of 2 (full plan)
- **Date**: 2026-06-06
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

The load-bearing risk — RLS per-user isolation — is implemented correctly: RLS enabled, four granular per-operation policies TO authenticated, both INSERT and UPDATE carry WITH CHECK, anon denied by default-deny. Every planned change matches intent column-for-column; all automated criteria are green (`db:types` regenerates with no drift, `astro check` 0 errors, `eslint .` clean).

## Findings

### F1 — user_id has no `default auth.uid()`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260606150950_create_library_entries.sql:9
- **Detail**: `user_id uuid not null` has no column default. The INSERT policy's WITH CHECK (auth.uid() = user_id) guarantees a foreign user_id can never be written, so isolation is safe. But because there's no `default auth.uid()`, every downstream insert (S-01+) must set user_id explicitly or the insert fails. Correctness-safe choice, not a hole — a foot-gun the consuming slice inherits. The plan deliberately defers app inserts, so this was never exercised here.
- **Fix**: Add `default auth.uid()` to the user_id column in a follow-up migration so app inserts can omit it and still pass WITH CHECK — OR leave as-is and document the "must set user_id" requirement for S-01.
- **Decision**: FIXED — added `default auth.uid()` to user_id in the migration (edited in place, unshipped); db reset + types regenerated (Insert.user_id now optional); typecheck + lint green.

### F2 — Unplanned tooling changes (eslint.config.js, .prettierignore)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js:73-75, .prettierignore (new file)
- **Detail**: Two files outside the plan's "Changes Required" list were modified: a `{ ignores: ["src/db/database.types.ts"] }` entry added to eslint.config.js and a new .prettierignore ignoring the same file. Both are benign and well-justified — the generated DB types are re-emitted verbatim by `npm run db:types`, so linting/formatting them would only cause diff churn, and ignoring them is what keeps `npm run lint` green (criterion 2.3). Each carries an explanatory comment. Flagged only because the plan's Changes/NOT-Doing lists didn't anticipate them.
- **Fix**: Accept as benign and note in the plan as a one-line addendum (they directly serve success criterion 2.3). No code change needed.
- **Decision**: FIXED — added Phase 2 item #5 addendum to plan.md documenting the eslint.config.js + .prettierignore ignores. No code change.

### F3 — LibraryEntry.play_status typed as `string`, not PlayStatus

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/types.ts:13 (via src/db/database.types.ts Row)
- **Detail**: LibraryEntry.play_status / metadata_status resolve to `string` / `string | null` because the Supabase CLI can't infer CHECK constraints into literal unions. The PlayStatus / MetadataStatus unions exist separately but aren't woven into the entity type, so consuming code gets no compile-time narrowing on these columns. This matches the plan's design (DB value stays string; label maps key off the union) — noted only so S-01 knows to narrow at the boundary.
- **Fix**: Optional — in S-01, expose a narrowed view type (e.g. `LibraryEntry & { play_status: PlayStatus }`) or narrow at read time. No change needed in this foundation.
- **Decision**: FIXED — narrowed `LibraryEntry` (Row entity) `play_status` → `PlayStatus` and `metadata_status` → `MetadataStatus | null` via Omit+intersection in src/types.ts; Insert/Update left as generated `string`; typecheck + lint green.
