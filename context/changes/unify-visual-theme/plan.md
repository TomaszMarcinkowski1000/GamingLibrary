# Unify Visual Theme Across Auth, Library & Play-Next Implementation Plan

## Overview

The landing page (`Welcome.astro`) wears an emerald/neon theme — a deep green-black base, a neon grid floor, accent glows, and an emerald/teal/cyan color vocabulary. The four authenticated/auth surfaces (sign in, sign up, library, what-to-play-next) wear an unrelated `bg-cosmic` blue/purple theme. This plan extracts the emerald theme into a reusable `ThemedLayout`, retunes the shadcn dark design tokens so every React island (dialogs, dropdowns, buttons) follows along, and migrates all surfaces to the unified look. It also fully redesigns the shared `Topbar` and moves the "what to play next" action into it.

This is roadmap **H-04** (GitHub #25), an enhancement spanning the pages plus a shared theme shell.

## Current State Analysis

- **The emerald theme is fully inline in `Welcome.astro:23-145`** — `bg-[#070b09]` base, an SVG-less neon grid built from layered `linear-gradient` backgrounds with a radial `mask-image`, two blurred accent glows (emerald + cyan), and literal `emerald-*/teal-*/cyan-*` utility classes throughout. None of it is reusable.
- **`Layout.astro` is structural only** (`src/layouts/Layout.astro`) — `<!doctype>`, `<head>`, the `missingConfigs` banner, a `<slot/>`, and a tiny reset `<style>`. It carries no theme, which is precisely why the pages diverged.
- **`bg-cosmic` is a Tailwind `@utility` in `global.css:118-120`** (a navy vertical gradient). The four target pages each wrap their content in `bg-cosmic … text-white`, use a `from-blue-200 to-purple-200` clip-text gradient for headings, and `text-blue-100/*` for body copy.
- **Critical: the shadcn dark CSS variables in `global.css:41-78` are deliberately tuned to the cosmic navy/violet palette** — `--primary` is violet `oklch(0.55 0.18 280)`, and `--background`/`--card`/`--popover` are navy oklch values. The comment at `global.css:45-46` documents this intent. Every React island that uses semantic tokens (`bg-primary`, `bg-card`, `border-input`, `bg-popover`, `text-muted-foreground`) — `Button`, `Input`, `Dialog`, `Select`, `Command`, `Popover`, `DropdownMenu`, and the library form components — inherits this palette. Recoloring only the page wrappers would leave every dialog and dropdown navy/violet against an emerald page.
- **~19 hardcoded old-palette references** sit outside the token system, in: `Topbar.astro` (5), `FormField.tsx:37,53`, `SubmitButton.tsx:18`, `SignUpForm.tsx:59`, `GameDialog.tsx:340`, `EntryRowActions.tsx:32`, `LibraryFilters.tsx:31-32,122,162,203`, `playStatus.ts:13-14,17`, `LibBadge.astro:10,12`.
- **The sort dropdown is a notch shorter than the filter controls.** `LibraryFilters.tsx` shares a `CONTROL_CLASS` with `h-10` across the filter popovers and Apply/Clear buttons (line 31-32), and the `SelectTrigger` appends it (line 160) — but the shadcn `SelectTrigger` carries its own `data-[size=default]:h-9`. Because that's a different modifier, `tailwind-merge` doesn't dedupe it against the plain `h-10`, and CSS source order can let `h-9` win. The sort control ends up at 36px while its neighbors are 40px.
- **`playStatus.ts:12-18` encodes meaning by hue** — neutral=not played, sky=playing now, emerald=played, green=completed, violet=100%. Only the `not_played` neutral (`text-blue-100/70`) belongs to the old palette; the rest are semantic state colors.
- **`confirm-email.astro`** also uses `bg-cosmic` — it's the third auth page, not named in the change.md "four".
- **`index.astro:1-8`** renders `<Welcome />` inside `Layout`. Welcome owns its own full-height themed `<div>`.

### Key Discoveries

- Token retune is the linchpin: `global.css:41-78` drives all islands. Get this right and dialogs/dropdowns/buttons unify "for free." (`global.css:45-46` comment explains the current cosmic tuning.)
- `Welcome.astro` is the reference design — refactoring it onto the new shell both DRYs the code and proves the shell reproduces the known-good look pixel-for-pixel.
- shadcn primitives in `src/components/ui/` are already 100% semantic-token-driven (`button.tsx`, `input.tsx`, `dialog.tsx`, `select.tsx`, `command.tsx`, `popover.tsx`, `dropdown-menu.tsx`, `alert-dialog.tsx`) — no per-file color edits needed there beyond the deliberate dialog glass/accent pass.
- The Topbar (`Topbar.astro`) renders on library & play-next and has both a signed-in and signed-out branch; it's the natural single home for cross-page nav.

## Desired End State

Sign in, sign up, confirm-email, library, and what-to-play-next all render on the emerald/neon theme: a green-black base with emerald accents, emerald/teal/cyan gradient headings, emerald-primary + glass-secondary buttons, and emerald-themed dialogs and dropdowns that visually match the surrounding page cards. The landing page is unchanged but now consumes the same shell. The Topbar is a redesigned bar carrying the wordmark (the route back to the library) and a prominent emerald "▶ Play next" CTA alongside the account controls; the redundant in-page nav links are gone. No `bg-cosmic` or stray blue/purple class survives outside the semantically-colored status badges.

Verification: `npm run lint`, `npm run build`, and the type-checked lint pass all succeed; a per-page manual visual checklist confirms each surface matches the landing look and every island/dialog reads legibly.

## What We're NOT Doing

- **No visual-regression / screenshot tests.** Verification is lint + build + a manual checklist. Adding Playwright baselines is a separate initiative.
- **No bespoke dialog *layout* redesign** — headers/footers/spacing/animations/flows stay as they are. Only color, surface (glass), border, and primary-action accents change.
- **No structural redesign of the auth forms** — `FormField` stays a hand-rolled glass input; we do not migrate it to the shadcn `Input` primitive.
- **No collapsing of the status-badge palette** to emerald shades — semantic hues are preserved; only the `not_played` neutral changes.
- **No changes to behavior, data, routing logic, or copy** beyond removing two now-redundant in-page nav links and adding the Topbar CTA.
- **No new Topbar nav features** beyond the wordmark + Play-next CTA + account controls (no search, no menu).

## Implementation Approach

Work outside-in from the token layer. Phase 1 establishes the single source of truth — retuned tokens + a `ThemedLayout` with a `decoration` prop — and immediately re-points `Welcome.astro` at it as a correctness check (the landing must look identical). Phases 2–3 migrate the auth surfaces and the app pages onto the shell, recoloring the hardcoded stragglers as each page is touched. Phase 4 gives the dialogs their deliberate emerald-glass pass. Phase 5 rebuilds the Topbar and consolidates navigation. Each phase ends at a visual checkpoint so the decoration variant and palette can be tuned against real rendered pages before moving on.

## Critical Implementation Details

- **Token retune is oklch, not hex.** The dark block (`global.css:41-78`) uses `oklch()` values. Shift `--primary`/`--ring` toward emerald (≈ `oklch(0.7 0.15 160)` family) and `--background`/`--card`/`--popover`/`--secondary`/`--muted`/`--accent` toward the green-black `#070b09` family (low-L, low-chroma, hue ≈ 150-165). Tune by eye against the rendered islands; keep `--foreground` near-white and verify text/border contrast on every surface. The `color-scheme: dark` line and the explanatory comment at `global.css:42-46` must be updated to describe emerald, not "cosmic navy."
- **The sort-dropdown height fix is a tailwind-merge interaction**, not a missing class. The `SelectTrigger`'s internal `data-[size=default]:h-9` survives the `cn(CONTROL_CLASS, …)` merge because it carries a `data-*` modifier. Force the trigger to `h-10` in a way that actually wins (e.g. pass `size`-neutral classes or override the data-variant), and confirm the rendered height matches the sibling filter buttons.
- **`ThemedLayout` must reproduce the grid/glow exactly for `decoration="full"`.** Lift the grid `linear-gradient` + `mask-image` and the two glow `<div>`s verbatim from `Welcome.astro:24-38` so the landing is unchanged after refactor. The `calm` variant drops/softens the grid and keeps faint glows.

## Phase 1: Theme Foundation + Welcome Refactor

### Overview

Establish the single source of truth: retune the shadcn dark tokens to emerald, remove the dead `bg-cosmic` utility and fix its comments, create `ThemedLayout.astro` (with a `decoration` variant prop), and re-point `Welcome.astro` and `index.astro` at it. The landing page must render identically — this validates the shell against the reference design before any other page depends on it.

### Changes Required:

#### 1. Retune shadcn dark tokens

**File**: `src/styles/global.css`

**Intent**: Shift the `.dark` palette from cosmic navy/violet to emerald green-black so every semantic-token-driven island matches the new theme. Update the explanatory comments to describe emerald, not cosmic navy.

**Contract**: Edit the `.dark { … }` block (`global.css:41-78`). `--primary` and `--ring` move to an emerald hue; `--background`, `--card`, `--popover`, `--secondary`, `--muted`, `--accent` move to the green-black family (deep low-L, low-chroma, hue ≈ 150-165). `--foreground` stays near-white; `--destructive`, chart, and sidebar vars may stay. Update comments at lines 42-46. `:root` (light) block is untouched. Values are oklch; tune against rendered islands.

#### 2. Remove the `bg-cosmic` utility

**File**: `src/styles/global.css`

**Intent**: Delete the now-unused navy gradient utility so no page can accidentally reuse it and grep for "cosmic" comes back clean.

**Contract**: Remove the `@utility bg-cosmic { … }` block (`global.css:118-120`). Removal is safe only once Phases 2–3 have dropped every `bg-cosmic` reference — so in this phase, delete the utility *last* or accept that the four pages temporarily lose their navy background (acceptable since they're migrated in Phases 2–3). Recommended: keep the utility through Phase 3 and delete it here only if no references remain; otherwise defer the deletion line to Phase 3's cleanup. (Tracked as an automated grep check in Phase 3.)

#### 3. Create `ThemedLayout.astro`

**File**: `src/layouts/ThemedLayout.astro` (new)

**Intent**: A reusable layout that renders the emerald themed background (base color, neon grid, accent glows) around a `<slot/>`, built on top of the structural `Layout.astro`. A `decoration` prop selects how much of the landing treatment shows.

**Contract**: Props: `title?: string` (forwarded to `Layout`) and `decoration?: "full" | "calm"` (default `"calm"`). Renders `<Layout title={title}>` wrapping a full-min-height themed container (`bg-[#070b09] text-emerald-50` + relative/overflow), the grid floor, and the glow `<div>`s, then `<slot/>` in a `relative z-10` content layer. `decoration="full"` reproduces `Welcome.astro:24-38` verbatim (grid + both glows); `decoration="calm"` drops or faintly renders the grid and keeps subtle glows. The grid and glows are `pointer-events-none`.

#### 4. Refactor `Welcome.astro` onto the shell

**File**: `src/components/Welcome.astro`

**Intent**: Make the landing page consume `ThemedLayout` (full decoration) instead of its inline theme, so the shell has a single source of truth and the divergence can't recur.

**Contract**: Remove the outer themed `<div>`, grid, and glow markup (`Welcome.astro:23-39`, plus the closing wrappers). The hero/features/footer content moves into `ThemedLayout`'s slot. Because `index.astro` currently wraps `<Welcome/>` in `Layout`, decide the seam: either `Welcome` renders `ThemedLayout` itself (and `index.astro` stops wrapping in `Layout`), or `index.astro` switches to `ThemedLayout decoration="full"` and `Welcome` becomes content-only. Pick the latter for consistency with the other pages. The rendered landing must be visually identical to before.

#### 5. Point `index.astro` at the shell

**File**: `src/pages/index.astro`

**Intent**: Render the (now content-only) landing inside `ThemedLayout` with full decoration.

**Contract**: Replace `Layout` import/usage with `ThemedLayout` and pass `decoration="full"`. Title preserved.

### Success Criteria:

#### Automated Verification:

- [ ] Type-checked lint passes: `npm run lint`
- [ ] Production build succeeds: `npm run build`
- [ ] `ThemedLayout.astro` exists: `ls src/layouts/ThemedLayout.astro`

#### Manual Verification:

- [ ] Landing page (`/`) renders pixel-identical to before the refactor (grid, glows, hero, feature cards, footer).
- [ ] An ad-hoc page wrapped in `ThemedLayout decoration="calm"` shows the green-black base with softened/absent grid.
- [ ] A shadcn island rendered on a dark page (e.g. open any existing dialog) now reads emerald/green-black, not navy/violet.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the landing is unchanged and the token retune looks right before proceeding.

---

## Phase 2: Auth Surfaces

### Overview

Migrate sign in, sign up, and confirm-email onto `ThemedLayout` (full decoration) and recolor the auth form components off the old palette.

### Changes Required:

#### 1. Auth pages onto the shell

**Files**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`

**Intent**: Replace `Layout` + `bg-cosmic` wrapper with `ThemedLayout decoration="full"`, and swap the heading gradient to emerald/teal/cyan.

**Contract**: In each file, switch the import/usage to `ThemedLayout` (`decoration="full"`), drop the `bg-cosmic` class from the centering wrapper (keep the flex-center + min-h layout), and change the `<h1>` gradient `from-blue-200 to-purple-200` → `from-emerald-300 via-teal-200 to-cyan-300`. The glass card (`bg-white/10 border-white/10`) and `text-blue-100/60` helper text become emerald-tinted (`text-emerald-100/60` and emerald-tinted border) to match. The signup/signin cross-links (`text-purple-300`) → emerald.

#### 2. Recolor `FormField`

**File**: `src/components/auth/FormField.tsx`

**Intent**: Move the label and focus ring off the old palette to emerald; keep the glass input structure.

**Contract**: `text-blue-100/80` label (line 37) → emerald-tinted; `focus:ring-purple-400` (line 53) → emerald focus ring. Error state (`red-400`) unchanged. `inputBase` glass styling unchanged.

#### 3. Recolor `SubmitButton`

**File**: `src/components/auth/SubmitButton.tsx`

**Intent**: Make the primary submit button the emerald-primary style (solid emerald, dark text, subtle glow) matching the landing CTA.

**Contract**: `bg-purple-600 … hover:bg-purple-500 text-white` (line 18) → emerald-400 background, dark (`text-[#06120c]`-ish) text, `hover:bg-emerald-300`, optional glow shadow. Verify the pending/disabled state (spinner border colors at line 22) reads on emerald.

#### 4. Recolor `SignUpForm` hint

**File**: `src/components/auth/SignUpForm.tsx`

**Intent**: Move the password-hint text off blue.

**Contract**: `text-blue-100/50` (line 59) → emerald-tinted neutral.

### Success Criteria:

#### Automated Verification:

- [ ] Type-checked lint passes: `npm run lint`
- [ ] Production build succeeds: `npm run build`
- [ ] No `bg-cosmic` remains in `src/pages/auth/`: `grep -r "bg-cosmic" src/pages/auth/` returns nothing.

#### Manual Verification:

- [ ] `/auth/signin`, `/auth/signup`, `/auth/confirm-email` render on the emerald theme with the full landing treatment.
- [ ] Form inputs show an emerald focus ring; labels and helper text are emerald-tinted; error states still read red.
- [ ] The submit button is solid emerald with legible text in default, hover, and pending states.

**Implementation Note**: Pause for manual confirmation of the auth flow visuals before proceeding.

---

## Phase 3: App Pages (Library & Play-Next)

### Overview

Migrate the library and play-next pages onto `ThemedLayout` (calm decoration), apply emerald gradient headings and emerald-primary/glass-secondary buttons, recolor the remaining hardcoded islands, fix the sort-dropdown height, retune the status-badge neutral, recolor `LibBadge`, and complete the `bg-cosmic` removal.

### Changes Required:

#### 1. Library & play-next pages onto the shell

**Files**: `src/pages/library/index.astro`, `src/pages/play-next/index.astro`

**Intent**: Replace the `bg-cosmic` `<main>` wrapper with `ThemedLayout decoration="calm"`, swap heading gradients to emerald/teal/cyan, and move action buttons to the emerald-primary / glass-secondary language.

**Contract**: Switch import/usage to `ThemedLayout` (`decoration="calm"`); the `<main>` keeps its padding/`text-white`→`text-emerald-50` but drops `bg-cosmic`. `<h1>` gradients (`library:142`, `play-next:79`) → `from-emerald-300 via-teal-200 to-cyan-300`. Body copy `text-blue-100/*` → emerald-tinted equivalents across both files (counts, table cell text, empty/error states, pagination). Glass surfaces (`bg-white/5 border-white/10`) gain emerald-tinted borders. Secondary buttons stay glass with emerald-tinted borders; any primary action uses the emerald-primary style. The play-next length/mode form controls (`accent-purple-400` at `play-next:108`, focus borders) → emerald. NOTE: the in-page nav links (library's "What should I play next?" button, play-next's "← Back to library") are removed in Phase 5, not here.

#### 2. Recolor & fix `LibraryFilters`

**File**: `src/components/library/LibraryFilters.tsx`

**Intent**: Move the control bar off blue and fix the sort-dropdown height mismatch.

**Contract**: Update the `CONTROL_CLASS` comment (line 29-30) and any blue text; `placeholder:text-blue-100/40` (line 122) → emerald-tinted; `text-blue-100/60` sort label (line 162) → emerald-tinted; `bg-blue-500/40` selection-count badge (line 203) → emerald. The `CONTROL_CLASS` glass (`border-white/20 bg-white/10`) gains emerald tint to match other surfaces. **Sort-height fix**: ensure the `SelectTrigger` (line 158-161) renders at `h-10` to match the filter popovers — override the primitive's `data-[size=default]:h-9` so the merged height actually wins. Semantic-token classes inside the popover (`bg-primary`, `text-muted-foreground`) are left alone (they follow the retuned tokens).

#### 3. Recolor `EntryRowActions` & `GameDialog` trigger

**Files**: `src/components/library/EntryRowActions.tsx`, `src/components/library/GameDialog.tsx`

**Intent**: Move the edit/delete action icons off blue.

**Contract**: `EntryRowActions.tsx:32` `text-blue-100/70` → emerald-tinted neutral (keep the `hover:bg-red-500/15 hover:text-red-300` destructive hover). `GameDialog.tsx:340` `text-blue-100/70` edit-button icon → emerald-tinted neutral.

#### 4. Retune the status-badge neutral

**File**: `src/components/library/playStatus.ts`

**Intent**: Move only the `not_played` neutral off the old blue palette; preserve the semantic sky/emerald/green/violet hues.

**Contract**: `not_played` (line 13) `text-blue-100/70` and its border → an emerald-tinted neutral. Lines 14-17 (sky/emerald/green/violet) unchanged. Update the docstring note about the "cosmic palette" (line 4).

#### 5. Recolor `LibBadge`

**File**: `src/components/ui/LibBadge.astro`

**Intent**: Move the badge off blue/purple to the emerald family.

**Contract**: `bg-blue-900/50 text-blue-200` (line 10) and `bg-purple-500/30 text-purple-200` (line 12) → emerald-family tints. Verify the two-tone (label vs version) still reads as two distinct levels.

#### 6. Finalize `bg-cosmic` removal

**File**: `src/styles/global.css`

**Intent**: Delete the `@utility bg-cosmic` now that no page references it (deferred from Phase 1 if not already removed).

**Contract**: Remove the `@utility bg-cosmic { … }` block if still present. Confirmed by the grep check below.

### Success Criteria:

#### Automated Verification:

- [ ] Type-checked lint passes: `npm run lint`
- [ ] Production build succeeds: `npm run build`
- [ ] No `bg-cosmic` anywhere in `src/`: `grep -rn "bg-cosmic" src/` returns nothing.
- [ ] No stray old-palette classes on the migrated app pages: `grep -rn "blue-100\|purple-300\|purple-400\|blue-500/40" src/pages/library src/pages/play-next src/components/library/LibraryFilters.tsx src/components/library/EntryRowActions.tsx` returns nothing (status-badge hues excepted, which live in `playStatus.ts`).

#### Manual Verification:

- [ ] `/library` and `/play-next` render on the calm emerald variant; tables and filters are legible.
- [ ] The sort dropdown is the same height as the filter popover buttons.
- [ ] Status badges still read distinctly per status; the not-played badge is emerald-tinted, not blue.
- [ ] Filter popovers, the sort menu, and selection-count badges read emerald/green-black.
- [ ] Decision point: confirm calm vs full decoration on these pages — flip the `decoration` prop to `"full"` if preferred after seeing it.

**Implementation Note**: Pause for manual confirmation, including the calm-vs-full decoration decision, before proceeding.

---

## Phase 4: Dialog Glass & Emerald Accents

### Overview

Give the dialogs a deliberate emerald-glass pass beyond the token inheritance: a blurred glass panel, emerald-tinted border, and emerald primary actions, so dialogs echo the page cards rather than reading as flat shadcn surfaces.

### Changes Required:

#### 1. Dialog content surface

**File**: `src/components/ui/dialog.tsx`

**Intent**: Make the dialog content panel a green-black glass surface with an emerald-tinted border matching the page cards.

**Contract**: On `DialogContent`'s class (line 50-52), add `backdrop-blur` and an emerald-tinted border/background tint layered over the `bg-background` token. Optionally darken/tint the `DialogOverlay` (line 29) toward green-black instead of plain `bg-black/50`. The close button (line 60) inherits tokens — verify it reads on the new surface. Layout/animation classes unchanged.

#### 2. Alert-dialog surface

**File**: `src/components/ui/alert-dialog.tsx`

**Intent**: Match the alert-dialog (used by `DeleteEntryDialog`) to the same glass/emerald treatment, while keeping the destructive action clearly red.

**Contract**: Apply the same glass/border treatment to the alert-dialog content surface. The destructive confirm action stays red (token `--destructive`); do not emerald-tint the delete confirmation.

#### 3. GameDialog / DeleteEntryDialog accents

**Files**: `src/components/library/GameDialog.tsx`, `src/components/library/DeleteEntryDialog.tsx`

**Intent**: Ensure the primary action inside each dialog (Save / Add) uses the emerald-primary button and the dialog header/spacing reads on the glass surface; leave destructive flows red.

**Contract**: Confirm the submit/primary buttons render emerald-primary (they use the `Button` primitive → retuned `--primary`, so this is mostly verification). Any remaining hardcoded text colors inside these components are moved to emerald-tinted neutrals. No layout/flow changes.

### Success Criteria:

#### Automated Verification:

- [ ] Type-checked lint passes: `npm run lint`
- [ ] Production build succeeds: `npm run build`

#### Manual Verification:

- [ ] Add-game, edit-game, and platform-combobox dialogs render as emerald-glass panels matching the page cards.
- [ ] The delete confirmation reads on-theme but keeps a clearly red destructive action.
- [ ] Dialog text, inputs, selects, and the close button are all legible on the new surface.
- [ ] Opening/closing animations still work; no layout shift or clipping regressions.

**Implementation Note**: Pause for manual confirmation across the add/edit/delete flows before proceeding.

---

## Phase 5: Topbar Redesign + Nav Consolidation

### Overview

Fully redesign the shared Topbar to the emerald theme with the wordmark as the route back to the library and a prominent emerald "▶ Play next" CTA, and remove the now-redundant in-page navigation links.

### Changes Required:

#### 1. Redesign the Topbar

**File**: `src/components/Topbar.astro`

**Intent**: Rebuild the bar on the emerald theme: a branded wordmark on the left (linking to `/library`, echoing the landing wordmark — the small glowing emerald square + uppercase tracking), a prominent emerald "▶ Play next" primary CTA, and the account controls (email + Sign out) on the right. The signed-out branch shows the wordmark plus emerald Sign in / Sign up links.

**Contract**: Replace the current blue/purple classes (`Topbar.astro:6,13,19,21,29,31,34`). Signed-in layout: `[▪ wordmark → /library]  …  [▶ Play next → /play-next]  [email]  [Sign out]`. The Play-next CTA is the emerald-primary style with a play glyph; the wordmark is the back-to-library affordance (no separate "Library" link). Email and Sign out move to emerald-tinted neutrals. The bar container (`border-white/10 bg-white/5`) gains emerald tint. Signed-out branch: wordmark + emerald Sign in/Sign up links. The Play-next CTA appears only in the signed-in branch.

#### 2. Remove redundant in-page nav

**Files**: `src/pages/library/index.astro`, `src/pages/play-next/index.astro`

**Intent**: Delete the in-page nav links now owned by the Topbar.

**Contract**: Remove the library "What should I play next?" button (`library/index.astro:152-160`, the `!isEmpty` anchor). Remove the play-next "← Back to library" link (`play-next/index.astro:84-89`). Re-flow each page header so spacing/alignment stays correct with the link gone. The library empty-state guidance is unaffected (play-next isn't useful with 0 games).

### Success Criteria:

#### Automated Verification:

- [ ] Type-checked lint passes: `npm run lint`
- [ ] Production build succeeds: `npm run build`
- [ ] No old-palette classes remain in the Topbar: `grep -n "blue-\|purple-" src/components/Topbar.astro` returns nothing.

#### Manual Verification:

- [ ] The Topbar renders the emerald wordmark, the "▶ Play next" emerald CTA, and account controls; layout holds on narrow widths.
- [ ] Clicking the wordmark returns to `/library`; the Play-next CTA navigates to `/play-next` from any signed-in page.
- [ ] The signed-out Topbar shows wordmark + Sign in/Sign up.
- [ ] The library page no longer shows an inline play-next button; the play-next page no longer shows a back link; both headers are well-aligned.

**Implementation Note**: Final phase — after manual confirmation, run the full cross-page visual checklist (Testing Strategy below) before closing the change.

---

## Testing Strategy

### Automated:

- `npm run lint` (type-checked) and `npm run build` after each phase.
- Grep gates: no `bg-cosmic` in `src/`; no stray `blue-*`/`purple-*` on migrated pages and the Topbar (status-badge hues in `playStatus.ts` excepted).

### Manual Testing Steps (final cross-page checklist):

1. Visit `/` — landing unchanged (full grid + glows, hero, cards, footer).
2. Visit `/auth/signin`, `/auth/signup`, `/auth/confirm-email` — full emerald treatment; focus rings emerald; submit button emerald; errors still red.
3. Visit `/library` — calm emerald variant; emerald gradient heading; legible table; sort dropdown height matches filters; status badges distinct; open add/edit/delete dialogs (emerald glass; delete stays red).
4. Visit `/play-next` — calm emerald variant; form controls emerald; ranked table legible.
5. Exercise the Topbar from both `/library` and `/play-next`: wordmark → library, "▶ Play next" → play-next; account controls work; signed-out state correct.
6. Confirm no in-page play-next button or back link remains.
7. Spot-check contrast on every dialog/dropdown/badge for legibility on the green-black surfaces.

## Performance Considerations

Negligible. The grid/glow decoration is the same CSS already shipping on the landing page; the `calm` variant renders less of it. No new JS, no new network requests. Token changes are CSS-variable value swaps.

## Migration Notes

No data or schema involved. The only behavioral change is navigation: the play-next action moves from in-page links to the Topbar. Rollback is a straight git revert — no migrations to undo. Because `Welcome.astro`/`index.astro` are refactored onto the shared shell in Phase 1, a regression there is the highest-value thing to catch early (hence the Phase 1 "identical landing" gate).

## References

- Change identity: `context/changes/unify-visual-theme/change.md`
- Roadmap entry: `context/foundation/roadmap.md` (H-04, line 265-270)
- Reference design (theme source): `src/components/Welcome.astro:23-145`
- Token layer: `src/styles/global.css:41-78` (dark vars), `:118-120` (`bg-cosmic`)
- Status-badge semantics: `src/components/library/playStatus.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Theme Foundation + Welcome Refactor

#### Automated

- [x] 1.1 Type-checked lint passes: `npm run lint`
- [x] 1.2 Production build succeeds: `npm run build`
- [x] 1.3 `ThemedLayout.astro` exists

#### Manual

- [x] 1.4 Landing page renders pixel-identical to before
- [ ] 1.5 `ThemedLayout decoration="calm"` shows green-black base with softened/absent grid
- [x] 1.6 A shadcn island on a dark page now reads emerald/green-black, not navy/violet

### Phase 2: Auth Surfaces

#### Automated

- [ ] 2.1 Type-checked lint passes: `npm run lint`
- [ ] 2.2 Production build succeeds: `npm run build`
- [ ] 2.3 No `bg-cosmic` remains in `src/pages/auth/`

#### Manual

- [ ] 2.4 signin/signup/confirm-email render on emerald theme with full treatment
- [ ] 2.5 Inputs show emerald focus ring; labels/helper text emerald-tinted; errors still red
- [ ] 2.6 Submit button solid emerald, legible in default/hover/pending states

### Phase 3: App Pages (Library & Play-Next)

#### Automated

- [ ] 3.1 Type-checked lint passes: `npm run lint`
- [ ] 3.2 Production build succeeds: `npm run build`
- [ ] 3.3 No `bg-cosmic` anywhere in `src/`
- [ ] 3.4 No stray old-palette classes on migrated app pages

#### Manual

- [ ] 3.5 `/library` and `/play-next` render calm emerald variant; tables/filters legible
- [ ] 3.6 Sort dropdown height matches filter popover buttons
- [ ] 3.7 Status badges read distinctly; not-played badge emerald-tinted
- [ ] 3.8 Filter popovers, sort menu, selection-count badges read emerald/green-black
- [ ] 3.9 Calm-vs-full decoration decision confirmed

### Phase 4: Dialog Glass & Emerald Accents

#### Automated

- [ ] 4.1 Type-checked lint passes: `npm run lint`
- [ ] 4.2 Production build succeeds: `npm run build`

#### Manual

- [ ] 4.3 Add/edit/combobox dialogs render as emerald-glass panels matching page cards
- [ ] 4.4 Delete confirmation on-theme but keeps clearly red destructive action
- [ ] 4.5 Dialog text/inputs/selects/close button legible on new surface
- [ ] 4.6 Animations work; no layout shift or clipping regressions

### Phase 5: Topbar Redesign + Nav Consolidation

#### Automated

- [ ] 5.1 Type-checked lint passes: `npm run lint`
- [ ] 5.2 Production build succeeds: `npm run build`
- [ ] 5.3 No old-palette classes remain in the Topbar

#### Manual

- [ ] 5.4 Topbar renders emerald wordmark, "▶ Play next" CTA, account controls; holds on narrow widths
- [ ] 5.5 Wordmark → `/library`; Play-next CTA → `/play-next` from any signed-in page
- [ ] 5.6 Signed-out Topbar shows wordmark + Sign in/Sign up
- [ ] 5.7 No inline play-next button on library; no back link on play-next; headers well-aligned
