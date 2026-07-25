<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Recommender Behavior Hardening

- **Plan**: `context/changes/testing-recommender-behavior-hardening/plan.md`
- **Scope**: Full plan — Phases 1–5 of 5 (all Progress rows `[x]`)
- **Date**: 2026-07-25
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations
- **Triage**: complete (2026-07-25) — all 3 findings FIXED

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Verification performed

Every automated success criterion across all five sub-phases was re-run, not taken on trust:

| Check | Result |
|---|---|
| `npx vitest run src/lib/services/recommendation.test.ts` | **33 passed** (plan target: 33) |
| `npx vitest run src/lib/services/recommendationCopy.test.ts` | **7 passed** |
| `npm test` | **172 passed / 9 files** |
| `npx astro check` | 0 errors, 0 warnings |
| `npm run lint` | clean |
| `npm run build` | exit 0 |
| `npx prettier --check` (test-plan + 3 changed test/src files) | clean |
| `grep "TBD — see §3 Phase 2" test-plan.md` | absent |
| `npx stryker run --mutate "src/lib/services/recommendation.ts"` | **94.27% total / 96.10% covered, 148 killed, 6 survived, 3 no-cov** — reproduces the recorded numbers exactly |

**Survivor triage cross-check (Phase 4, manual criterion 4.5).** The in-file triage block
(`recommendation.test.ts:32-77`) documents 9 items. The live Stryker run produced exactly those 9,
line-for-line: survived at `:60`, `:75`, `:131`, `:201`, `:203`, `:204`; no-coverage at `:65`,
`:129`, `:224`. No silent survivors, and no survivor at `isEligible` (`:92`) — which independently
corroborates Phase 3's manual criterion 3.5 (the de-prioritization assertion really does kill that
mutant rather than passing on tie-break luck).

**Extraction fidelity (Phase 2).** `emptyStateMessage()` moved from `index.astro:53-62` to
`src/lib/services/recommendationCopy.ts` character-for-character — all three strings identical
including the typographic apostrophe and curly quotes in the comfort sentence. Signature unchanged;
the page's call site untouched; the `RecommendationResult` type import is still used at
`index.astro:25`, so no dangling import.

## Findings

### F1 — Four stale `file:line` citations in the Phase-3 test comments

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/services/recommendation.test.ts:289,327,329,342`
- **Detail**: This phase's value is carried almost entirely by navigational comments that point a
  future reader at sibling assertions. Four of those pointers land on unrelated lines today:
  - `:289` cites the spot-check's `not.toContain("celeste")` as `` `:471` `` — actual **`:557`**;
    `:471` is inside the unrelated "empty-state reasons" describe.
  - `:329` cites the existing reversed-input determinism check as `` `:363-367` `` — actual
    **`:434-438`**.
  - `:327` and `:342` both cite the tie-break documentation test as `` `:369-378` `` — actual
    **`:440-464`**.

  All four were written in Phase 3 (`26c9307`) and were invalidated by Phase 3's and Phase 4's own
  insertions. Everything Phase 4 and Phase 5 wrote is accurate: `:32-77`, `:322-425`, `:455`,
  `:98-127`, and all six citations in test-plan §6.5 (`:81-96`, `:93-96`, `:18-30`, `:98-127`,
  `:322-425`, `:440-464`) check out. So the defect is confined and mechanical.
- **Fix**: Update the four citations to `:557`, `:434-438`, `:440-464`, `:440-464` respectively.
- **Decision**: FIXED — all four citations re-verified against the current file and corrected in
  place (`:289` → `:557`, `:327` → `:440-464`, `:329` → `:434-438`, `:342` → `:440-464`).
  Comment-only edits, so no line numbers shifted; `recommendation.test.ts` still 33 passed and
  prettier-clean.

### F2 — Plan's "What We're NOT Doing" still asserts `listAllEntries` is covered; it is not

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/testing-recommender-behavior-hardening/plan.md:116-117`
- **Detail**: The plan justifies skipping `getRecommendations()` partly on the grounds that
  "`listAllEntries` is already covered by `library.test.ts`". It is not — a repo-wide search finds
  `listAllEntries` only at its definition (`library.ts:339`), its single call site
  (`recommendation.ts:225`), and in comments. The implementation *caught* this: the §6.7 note
  explicitly records "contrary to this plan's 'What We're NOT Doing' bullet, which assumed
  `library.test.ts` covered it", and the in-file triage flags the `:224` no-coverage mutant as "a
  genuine hole rather than a covered one". That is exactly the right handling. The residual issue is
  only that the plan itself still carries the false premise, and plans are read as ground truth by
  later reviews.
- **Fix**: Add a one-line correction to the plan's bullet pointing at the §6.7 note, so the plan and
  the cookbook do not disagree.
- **Decision**: FIXED — added a nested **Correction (Sub-phase 4/5)** sub-bullet under the
  `getRecommendations()` guardrail in `plan.md`, naming `library.ts:339` / `recommendation.ts:225`,
  pointing at the §6.7 note, and noting the skip decision still stands on I/O-boundary grounds
  alone.

### F3 — Phase 4 rewrote an existing assertion that Phase 3 said would not be extended

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/lib/services/recommendation.test.ts:455-464`
- **Detail**: Sub-phase 3's anti-pattern note says the existing tie-break test "stays as
  code-documentation and is not extended", and Testing Strategy says the existing 30 assertions are
  "unchanged in meaning". Phase 4 changed both its fixture and its expected output
  (`["a","b","c"]` → `["c","a","b"]`). The change is well-justified and documented in place: the old
  fixture had its `created_at` order agreeing with its `id` order, so dropping the `created_at`
  branch still produced the expected result and the test verified only half its own name. This is
  precisely what Sub-phase 4 exists to find, and the mutation run confirms the fix (the `:200`
  branch mutant is now killed). Flagged only because it crosses an explicit plan guardrail without
  the plan being amended — the test's *title* is unchanged, but its expected value is not.
- **Fix**: None required. Optionally note in the plan that Sub-phase 4 superseded Sub-phase 3's
  "not extended" guardrail for this one test, with the mutation evidence.
- **Decision**: FIXED — took the optional plan amendment in two places: a **Superseded by
  Sub-phase 4** block under the Sub-phase 3 anti-pattern note (mutation evidence: the old fixture's
  `created_at` order agreed with its `id` order, so the `:201` branch mutant survived), and a
  parenthetical amendment to the Testing Strategy's "30 assertions unchanged in meaning" line.
