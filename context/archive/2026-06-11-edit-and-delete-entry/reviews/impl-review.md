<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Edit & Delete a Library Entry (S-02)

- **Plan**: context/changes/edit-and-delete-entry/plan.md
- **Scope**: All 3 phases
- **Date**: 2026-06-12
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

Automated criteria all green: typecheck (0 errors), lint (exit 0), 16/16 unit tests, build (exit 0). All 21 manual Progress items checked `[x]` with commit shas. Both review agents confirmed the two security-critical concerns — PUT mass-assignment and IGDB auth-gating — are correctly closed. All 11 planned items MATCH; no drift or missing work.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Unplanned "add→edit reopen" changes the add-flow UX

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: src/components/library/GameDialog.tsx:97-103, 187-221
- **Detail**: After a successful ADD, the dialog stays open and flips into edit mode pre-filled with the freshly-enriched entry (savedEntry / activeEntry state). The plan's add-mode contract said add behaves as S-01 (Save / Save-&-add-another, then list reload), and "What We're NOT Doing" implied no add-flow changes. This is a genuine behavior addition. It is cleanly built (true `entry` prop takes precedence over `savedEntry`) and is explicitly foreshadowed by the change.md design note: "S-01's post-save seam swap to reopen the just-saved entry in edit mode for review/correction." Aligns with documented design intent; just not in the plan's phase-3 contract, and it alters a flow the plan froze.
- **Fix A ⭐ Recommended**: Keep it; document as a plan addendum.
  - Strength: Realizes the change.md design note; natural review/correction path S-03's photo auto-save will lean on. Code is clean and well-isolated.
  - Tradeoff: Plan no longer fully describes the shipped add UX; future reviews using the plan as ground truth miss it.
  - Confidence: HIGH — the design note explicitly anticipated this.
  - Blind spot: Whether always-reopen is desired for every add, or should be opt-in.
- **Fix B**: Revert reopen to match the frozen add contract.
  - Strength: Strict scope discipline; add stays byte-identical.
  - Tradeoff: Loses working, design-note-aligned UX; likely re-added in S-03 anyway.
  - Confidence: MED — depends if S-03 planning wants it here vs there.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — kept; documented as plan addendum (2026-06-12).

### F2 — Unplanned dark-theme changes (Layout + global.css)

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/layouts/Layout.astro:14, src/styles/global.css
- **Detail**: f83d40e added `class="dark"` on `<html>` and retinted shadcn CSS vars toward the cosmic-navy palette (+ `color-scheme: dark`, dark native date/number controls). Not in the plan, but effectively required to make the new AlertDialog/Select/date inputs legible on the already-dark library page. No logic impact; affects global appearance.
- **Fix**: Keep; note in the addendum alongside F1. Sanity-check the auth/dashboard pages still render acceptably under the global dark class.
- **Decision**: FIXED — kept; documented in plan addendum. Sanity-check passed: auth/dashboard/index use white-on-glass styling independent of theme tokens, unaffected by the global dark class (2026-06-12).

### F3 — metadata_status nullable in update schema (verified safe)

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Data safety
- **Location**: src/lib/validation/library.ts:45
- **Detail**: Agent flagged a possible 500 if a PUT writes `metadata_status: null`. Verified non-issue: the column is `text check (... in ('matched','no_match'))` with NO NOT NULL (migration 20260606150950 :22), and Postgres CHECK passes on NULL — so null is accepted. On a plain edit the status is carried through unchanged (mapEntryToValues → mapValuesToBody), so the badge meaning is preserved. No action required.
- **Decision**: SKIPPED — verified non-issue; no action (2026-06-12).
