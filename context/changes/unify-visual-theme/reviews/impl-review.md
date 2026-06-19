<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Unify Visual Theme Across Auth, Library & Play-Next

- **Plan**: context/changes/unify-visual-theme/plan.md
- **Scope**: All 5 phases
- **Date**: 2026-06-19
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Verification Evidence

- `npm run lint` → pass (only harmless `astro-eslint-parser` parser-option warnings)
- `npm run build` → pass (server built in 7.36s)
- Grep gates → all clean: no `bg-cosmic` in `src/`; no stray `blue-100|purple-300|purple-400|blue-500/40` on migrated app pages; no `blue-/purple-` in Topbar
- `--destructive` token still red (hue 22); `--ring` emerald and visible; sort-height fix is real (`data-[size=default]:h-10` override wins via matching data-modifier)
- All 17 manual Progress items checked with commit shas and corroborated by the diff
- `:root` (light) token block untouched; app forces `class="dark"` so light mode never renders

## Findings

### F1 — Two files changed but not named in the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/auth/PasswordToggle.tsx, src/components/library/PlayNextModeSelect.tsx (new)
- **Detail**: The diff touches two files the plan never itemized. `PasswordToggle.tsx` is a one-line recolor (`text-white/40` → `text-emerald-200/40`) — squarely the theme migration. `PlayNextModeSelect.tsx` is a NEW component: it replaces the native `<select name="mode">` with a shadcn Select mirrored into a hidden input, preserving the GET-form contract. That's the actual mechanism behind the planned "play-next `accent-purple-400` → emerald" requirement (Phase 3 item 1) — a native option list keeps an un-themable OS-blue highlight, so it had to be swapped. Both are in-scope and benign, but the new component is a real (small) behavioral substitution the plan didn't anticipate.
- **Fix**: Note both files in the plan as an addendum (PasswordToggle = recolor; PlayNextModeSelect = native→shadcn select to remove the un-themable OS-blue, fulfilling the play-next off-blue requirement) so the plan stays the source of truth.
- **Decision**: FIXED — addendum added to plan.md ("## Addendum (Implementation Review, 2026-06-19)")

### F2 — Unitemized global.css theming rules

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/styles/global.css:~139-178
- **Detail**: Beyond the planned `.dark` token retune and `bg-cosmic` removal, global.css gained autofill + custom-checkbox (`.themed-checkbox`) theming rules. These support the emerald migration (input autofill no longer flashes browser-yellow/blue; the play-next checkboxes needed an emerald accent the native control couldn't provide) but weren't called out in the plan. Benign — noting for the record.
- **Fix**: Fold into the same plan addendum as F1.
- **Decision**: FIXED — covered by the plan.md addendum (global.css bullet)

### F3 — Emerald gradient heading duplicated across 6 files

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: Welcome.astro, 3 auth pages, library + play-next pages
- **Detail**: The `from-emerald-300 via-teal-200 to-cyan-300 bg-clip-text` heading treatment is copy-pasted in 6 files. The grid/glow CSS was correctly centralized in ThemedLayout, but this heading style was not. Shallow duplication; Astro has no cheap cross-file class primitive, so it's a low-value dedupe, not a defect.
- **Fix**: Optional — extract a shared `.themed-heading` utility in global.css if this gradient is reused again later.
- **Decision**: FIXED — added `@utility themed-heading` to global.css; replaced inline gradient classes in all 6 files (Welcome, signin, signup, confirm-email, library, play-next). Lint + build green.

### F4 — LibBadge.astro appears unused

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/LibBadge.astro
- **Detail**: The component was correctly recolored to emerald (`bg-emerald-900/50` + `bg-teal-500/30`) per plan, but it doesn't appear to be imported by any reviewed page. The recolor is correct; the dead-ish status is pre-existing and out of scope for this change. Flagging only so it's on the radar.
- **Fix**: None for this change — consider a separate cleanup if it's confirmed dead.
- **Decision**: FIXED — verified zero references repo-wide (`grep -rn LibBadge` clean); removed via `git rm src/components/ui/LibBadge.astro`. Build green.
