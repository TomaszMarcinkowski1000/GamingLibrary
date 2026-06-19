<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Normalize Photo-Extracted Platform Aliases and Title Casing

- **Plan**: context/changes/normalize-photo-platform-title/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-06-19
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated checks: `npm test` 124 passed; `npm run lint` 0 errors; `npm run typecheck` 0 errors; `npm run build` Complete. Consumers (`src/pages/api/identify.ts`) untouched and read `vision.title`/`vision.platform` at all sites (grounding L158, persist L176-177, responses L186-207) — choke-point normalization inherited everywhere, grounding-id invariance preserved.

## Findings

### F1 — Hyphenated shouty tokens lose inner casing

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (output quality)
- **Location**: src/lib/platforms.ts:123-124,160
- **Detail**: `titleCaseToken` uppercases only the token's first char, so a fully-shouty hyphenated read re-cases the whole token as one word: `"SPIDER-MAN"` → `"Spider-man"`, `"X-MEN"` → `"X-men"`. Reachable on the exact ALL-CAPS path the feature targets; Spider-Man / X-Men are common shelf titles. Not a plan miss (the plan splits on whitespace only and never mentioned hyphens) but a visible casing gap.
- **Fix**: In `titleCaseToken`, title-case each subtoken split on `[-/]` (e.g. `token.split(/([-/])/).map(titleCase).join("")`) so `"SPIDER-MAN"` → `"Spider-Man"`. Add one test case.
- **Decision**: FIXED — `titleCaseToken` now splits on `[-/]`; added `"MARVEL'S SPIDER-MAN"` → `"Marvel's Spider-Man"` test. 23 platforms tests pass.

### F2 — Roman-numeral guard false-positives on real words

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; accept or document
- **Dimension**: Safety & Quality (output quality)
- **Location**: src/lib/platforms.ts:120,158
- **Detail**: `ROMAN_NUMERAL` (`/^[ivxlcdm]+$/i`) matches any all-caps word composed solely of those letters, so genuine words freeze uppercase: `"MIX"`, `"DIM"`, `"LID"`, `"CIVIC"`, `"MILD"`. Fully-shouty `"DJ MIX"` → `"Dj MIX"`. Same documented-tradeoff class as `"FIFA 23"` → `"Fifa 23"` — a regex can't infer intent — just over-preserving instead of over-folding. Rare for game titles.
- **Fix**: Accept as a known tradeoff and add a one-line note beside the FIFA tradeoff in the plan's "What We're NOT Doing" (a clean fix needs a word list, not worth it).
- **Decision**: FIXED (documented) — added a "Not word-listing the roman-numeral guard" bullet to the plan's "What We're NOT Doing".
