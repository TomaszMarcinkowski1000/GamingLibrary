<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Mark a game with a play status (+ optional play time)

- **Plan**: context/changes/mark-play-status/plan.md
- **Scope**: All phases (1–3 of 3)
- **Date**: 2026-06-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

All 7 planned changes verified MATCH. Automated gates all pass: `npm run lint` (clean), `npm run build` (clean), `npm run format` (relevant files unchanged). Every Progress checkbox across Phases 1–3 is consistent with commits d5e2120, b8f2b80, 057a91f.

## Findings

### F1 — Unplanned entrySync.ts + GameDialog.tsx changes

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/library/entrySync.ts (new, 37 lines); src/components/library/GameDialog.tsx (+23 lines)
- **Detail**: Two files changed that no phase lists. `entrySync.ts` is a module-level EventTarget pub/sub (`publishEntryPatch` / `subscribeEntryPatch`) keyed by entry id; `GameDialog.tsx` consumes it (`liveEntry` state + useEffect subscription, GameDialog.tsx:105,126-133) so the retained dialog fields don't show stale status/hours after a no-reload inline change. This is a real correctness fix for an interaction the plan implicitly created: it kept the status/play-time fields in the dialog ("they stay", What We're NOT Doing) AND made the inline control mutate them with no reload — leaving the two islands out of sync until refresh. The addition is narrow, one-directional, and in-scope in spirit. The gap is only that the plan never names it, so a future reviewer using the plan as ground truth sees undocumented files.
- **Fix**: Add a one-line addendum to plan.md noting the entrySync bus + the GameDialog subscription as a discovered cross-island sync need.
- **Decision**: FIXED — added `## Addenda` section to plan.md

### F2 — Dropdown trigger not disabled while hours popover is open

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability / race)
- **Location**: src/components/library/PlayStatusControl.tsx:98-117,159
- **Detail**: While a finished-status hours popover is open (awaiting Save/Skip), `pending` is still false because the PATCH hasn't fired. The dropdown trigger isn't disabled in that window, so a user could re-pick a status; `selectStatus` would overwrite `pendingTransitionRef` with `previous` set to the optimistic status rather than the original server value. The single-PATCH-per-change guarantee still holds (last resolved transition fires once) — this is a rollback-baseline UX edge, not data corruption, and requires interacting with the dropdown around an open popover.
- **Fix**: Optionally disable the trigger when `pendingTransitionRef.current !== null`, in addition to the existing `pending` guard.
- **Decision**: FIXED — `disabled={pending || popoverOpen}` (reactive equivalent; ref wouldn't re-render)

### F3 — UI cannot send explicit play_time_hours: null

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/library/PlayStatusControl.tsx:62-68
- **Detail**: The schema carefully preserves "explicit null clears hours" (verified correct end to end), but `commit()` types `hours` as `number | undefined` and can only send a number or omit the key — never null. Blanking the input omits the field (old value kept) rather than clearing it. This is by design per the "leave blank to skip" copy and the plan's "always skippable hours"; noting the asymmetry for completeness. No change needed.
- **Decision**: SKIPPED — as-designed; "leave blank to skip" omits, does not clear
