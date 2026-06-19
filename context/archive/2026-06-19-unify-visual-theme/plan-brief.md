# Unify Visual Theme — Plan Brief

> Full plan: `context/changes/unify-visual-theme/plan.md`

## What & Why

The landing page wears an emerald/neon theme; sign in, sign up, library, and "what to play next" wear an unrelated `bg-cosmic` blue/purple theme. We extract the emerald theme into a reusable layout shell and migrate every surface to it, so the app looks like one product. This is roadmap **H-04** (GitHub #25).

## Starting Point

The emerald theme is hardcoded inline in `Welcome.astro`; `Layout.astro` is structural only and carries no theme. The shadcn dark CSS variables in `global.css` are tuned to the cosmic navy/violet palette, so every React island (dialogs, dropdowns, buttons) inherits the old look. A `bg-cosmic` utility and ~19 hardcoded blue/purple class references back the four divergent pages.

## Desired End State

All five surfaces (landing + four pages) share the emerald/neon look: green-black base, emerald/teal/cyan gradient headings, emerald-primary + glass-secondary buttons, and emerald-glass dialogs/dropdowns that match the page cards. The Topbar is redesigned around a branded wordmark (route back to library) and a prominent "▶ Play next" CTA, replacing the old in-page nav links. No `bg-cosmic` or stray blue/purple survives outside the semantically-colored status badges.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Theme extraction | New `ThemedLayout` wrapping `Layout` | Single source of truth; pages just swap their import and Welcome adopts it too. | Plan |
| shadcn dark tokens | Retune to emerald | Islands (dialogs, dropdowns, buttons) match the shell automatically — true unification. | Plan |
| Decoration on app pages | Calm variant via a `decoration` prop | Keeps tables legible while staying flippable to full treatment after a visual look. | Plan |
| Extra scope | confirm-email, Welcome refactor, LibBadge, Topbar | Closes every visible gap and prevents the divergence recurring. | Plan |
| Headings | Emerald/teal/cyan gradient | Direct visual match to the landing hero. | Plan |
| Buttons | Emerald primary + glass secondary | Clear hierarchy, on-brand, leans on the token retune. | Plan |
| Status badges | Keep semantic hues, retune not-played neutral | Status stays scannable; only the off-palette blue neutral changes. | Plan |
| Form fields | Emerald focus ring, keep glass | Minimal, on-brand, matches retuned `--ring`. | Plan |
| Dialogs | Token inheritance + glass/emerald accents | Dialogs feel designed for the theme, not just recolored. | Plan |
| Topbar | Full redesign; Play-next becomes the in-bar CTA | Persistent nav becomes the single home for cross-page navigation. | Plan |
| Verification | Lint/build + manual per-page checklist | Realistic for a visual change with no screenshot tests. | Plan |
| Cleanup | Remove `bg-cosmic` utility + fix comments | No dead code or misleading "cosmic navy" docs. | Plan |

## Scope

**In scope:** `ThemedLayout`; token retune; landing/auth/library/play-next migration; auth form recolor; status-badge neutral; `LibBadge`; dialog glass/emerald accents; sort-dropdown height fix; full Topbar redesign + nav consolidation; `bg-cosmic` removal.

**Out of scope:** screenshot/visual tests; dialog layout/flow redesign; migrating auth inputs to shadcn `Input`; collapsing status hues to emerald shades; any behavior/data/routing change beyond the Topbar nav move.

## Architecture / Approach

Work outside-in from the token layer. `global.css` dark vars retuned to emerald drive all islands; a new `ThemedLayout.astro` (with a `decoration: "full" | "calm"` prop) renders the green-black base + grid + glows around a `<slot/>`, on top of the structural `Layout.astro`. Welcome is re-pointed at the shell first as a correctness check (landing must look identical), then each page migrates and recolors its stragglers.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Theme foundation + Welcome refactor | Retuned tokens, `ThemedLayout`, `bg-cosmic` removal, landing on the shell | Landing regressing during refactor; getting the oklch token retune right |
| 2. Auth surfaces | signin/signup/confirm-email + form recolor | Emerald-on-dark contrast for inputs/errors |
| 3. App pages | library + play-next on calm variant, islands recolored, sort-height fix | Table legibility under decoration; sort-height tailwind-merge quirk |
| 4. Dialog glass & accents | Emerald-glass dialogs; delete stays red | Overlay/text contrast on the new surface |
| 5. Topbar redesign + nav | Wordmark + "▶ Play next" CTA; in-page links removed | Header re-flow; narrow-width layout |

**Prerequisites:** none — self-contained frontend change on `plan/unify-visual-theme`.
**Estimated effort:** ~2–3 sessions across 5 phases (each ends at a manual visual checkpoint).

## Open Risks & Assumptions

- The oklch token retune is tuned by eye; needs a contrast pass over every dialog/dropdown/badge.
- Decoration variant (calm vs full) on the data-heavy pages is a "see it to decide" call — the `decoration` prop makes it a one-line flip.
- `bg-cosmic` removal must be ordered after every reference is gone (grep-gated).

## Success Criteria (Summary)

- Every surface (landing + four pages) reads as one emerald-themed product, islands included.
- The Topbar carries the wordmark and the "▶ Play next" CTA; no duplicate in-page nav remains.
- `grep "bg-cosmic" src/` is empty; lint and build are green; the manual per-page checklist passes.
