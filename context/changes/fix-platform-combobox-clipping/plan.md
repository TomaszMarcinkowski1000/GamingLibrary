# Fix Platform Combobox Clipping (Add/Edit Dialog) Implementation Plan

## Overview

In the "Add manually" / edit game dialog, the platform combobox dropdown opens **upward** and is **cut off** (Roadmap v1 Hardening H-01, GitHub #22). This plan moves the dialog's scroll clip off the element the popover portals into, so the popover can render outside the clip and Radix can flip it up/down as space allows — while preserving the existing in-dialog portal that keeps wheel-scrolling working.

> **Re-plan note (2026-06-20):** the original approach in this plan — force `side="bottom"` + `avoidCollisions={false}` and cap the list to `--radix-popover-content-available-height` — was implemented and **failed manual verification**. Its premise ("the platform field is high in the dialog, so downward has room") is false: in the **add** dialog the layout is Header → Title → Platform → Footer, so the trigger sits near the bottom of a content-sized dialog with almost no room below. Forcing a side inside the dialog's `overflow-y-auto` clip cut the list off regardless of the height cap (confirmed on desktop). The approach below replaces it: stop clipping at the portal target instead of fighting the clip.

## Current State Analysis

The platform picker is `PlatformCombobox` (`src/components/library/PlatformCombobox.tsx`), a Radix `Popover` whose `PopoverContent` is **deliberately portalled into the dialog's content element** (`container={contentEl}`, wired through `GameFormFields.platformContainer` ← `GameDialog` `contentEl`). The comment at `PlatformCombobox.tsx:12-17` records why: portalling to `<body>` lets `react-remove-scroll` (used by the Radix Dialog) swallow mouse-wheel scrolling in the option list, so the popover must live **inside** the dialog's scroll-lock subtree.

The clipping is a CSS containing-block + overflow interaction:

- `DialogContent` (`src/components/ui/dialog.tsx:51`) is `position: fixed` **with a `translate-x/y-[-50%]` centering transform**. `GameDialog` put `max-h-[90dvh] overflow-y-auto` directly on it (`src/components/library/GameDialog.tsx:352`).
- A CSS `transform` on an ancestor makes it the **containing block for `position: fixed` descendants**. The Radix Popper content is `fixed`, so it is positioned relative to — and **clipped by** — `DialogContent`'s `overflow-y-auto`. The popover is portalled into this same `DialogContent` element (`container={contentEl}`), so the element it lives in is also the element that clips it.
- Because the popover is trapped inside that clip and the platform trigger sits near the **bottom** of the (short) add dialog, the dropdown is cut off at the dialog's bottom edge whichever way it opens. Radix's upward auto-flip (a reasonable choice — there's more room above) is then clipped by `overflow-y-auto`. Symptom: "opens upward and is cut off."

### Key Discoveries:

- The popover **must stay portalled inside the dialog** — `PlatformCombobox.tsx` documents that portalling to `<body>` reintroduces a `react-remove-scroll` wheel-swallow bug. The fix therefore cannot simply re-portal to `<body>`.
- The clip and the portal target are the **same element** (`DialogContent`). Separating them — keeping the popover portalled into `DialogContent` but moving `overflow-y-auto` onto an **inner wrapper** around the form — lets the popover render outside the clip while staying inside the `react-remove-scroll` lock subtree (so the wheel still scrolls the list).
- With the clip gone from the portal target, Radix's normal collision/flip against the **viewport** works: the popover opens whichever way has room and is never cut off. `CommandList`'s existing `max-h-[300px] overflow-y-auto` (`src/components/ui/command.tsx:69`) keeps a long list internally scrollable; no forced `side`, `avoidCollisions`, or height-var cap is needed on `PlatformCombobox`.
- The play-status `Select` in the same dialog uses `position="popper"` (`src/components/library/GameFormFields.tsx:122`) — same potential bug class, to be sanity-checked manually (not changed). It benefits from the same un-clipping.
- Tests exist via `vitest` (`npm run test`) but cover **only `src/lib/**`** — there is **no component/jsdom DOM-testing harness**, so a regression test would mean standing up new infra. The re-regression guard is therefore an explanatory code comment + manual verification.

## Desired End State

Opening the platform combobox in both the **add** and **edit** dialog, on desktop and on mobile/short viewports, shows the dropdown **fully visible (never cut off)** — Radix opens it whichever way (up or down) has room. A long option list scrolls internally. The form behind it still scrolls when it exceeds the viewport, and wheel-scrolling inside the option list continues to work (the in-dialog portal is preserved).

## What We're NOT Doing

- **Not** re-portalling the popover to `<body>` (would reintroduce the `react-remove-scroll` wheel-swallow bug).
- **Not** touching the shared `DialogContent` in `src/components/ui/dialog.tsx` — the scroll-structure change is local to `GameDialog.tsx`, which is where the `overflow-y-auto` currently lives.
- **Not** changing the play-status `Select` or other in-dialog poppers — they are sanity-checked, not modified (they inherit the un-clipping for free).
- **Not** adding a component/jsdom or Playwright test harness for this single fix.

## Implementation Approach

Stop clipping at the element the popover portals into. Today `GameDialog` puts `max-h-[90dvh] overflow-y-auto` directly on `DialogContent`, which is also the popover's portal target — so the popover is clipped by the very element it lives in. Move the `overflow-y-auto` (and the height cap) onto an **inner wrapper** that holds the header + form; leave `DialogContent` un-clipped as the portal target and containing block. The popover then renders as a sibling of that inner wrapper, outside the scroll clip, and Radix flips it up/down against the viewport — never cut off. The popover stays a DOM descendant of `DialogContent`, so the Dialog's `react-remove-scroll` lock still permits wheel-scrolling the list. `PlatformCombobox` reverts to its plain `PopoverContent` (no forced side / no height-var cap); only the portal-rationale comment is updated to point at the new load-bearing structure.

## Critical Implementation Details

- **Inner wrapper height = `calc(90dvh - 3rem)`** — `DialogContent` keeps its `p-6` (3rem total vertical padding); capping the inner scroller at `90dvh - 3rem` keeps the whole dialog within `90dvh` as before, with no clip on `DialogContent` itself.
- **Preserve the existing header→form gap** — `DialogContent`'s `grid gap-4` previously spaced the header from the form; the inner wrapper must reapply it (`grid gap-4`) so spacing is unchanged.
- **Wheel-scroll invariant** — the popover must remain portalled into `DialogContent` (not `<body>`, not the inner wrapper). Inside `DialogContent` but outside the inner scroller is exactly the spot that is both un-clipped and inside the `react-remove-scroll` subtree.

## Phase 1: Move dialog scroll off the popover's portal target + guard

### Overview

Move the dialog's `overflow-y-auto` from `DialogContent` (the popover's portal target) onto an inner form wrapper so the popover renders outside the clip, with a comment that prevents silent re-regression. Revert the failed forced-side experiment in `PlatformCombobox`.

### Changes Required:

#### 1. GameDialog scroll structure

**File**: `src/components/library/GameDialog.tsx`

**Intent**: Take the `overflow-y-auto` clip off the element the popover portals into, so the popover is no longer cut off, while keeping the form scrollable and the popover inside the `react-remove-scroll` lock.

**Contract**: Change `<DialogContent ref={setContentEl} className="max-h-[90dvh] overflow-y-auto">` to a plain `<DialogContent ref={setContentEl}>`, and wrap its children (the `DialogHeader` and the `form`) in a single inner `<div className="grid max-h-[calc(90dvh-3rem)] gap-4 overflow-y-auto">`. `platformContainer={contentEl}` (the popover portal target) is unchanged — it still points at `DialogContent`.

#### 2. Load-bearing guard comments

**Files**: `src/components/library/GameDialog.tsx`, `src/components/library/PlatformCombobox.tsx`

**Intent**: Prevent a future refactor from moving `overflow-y-auto` back onto `DialogContent` (which would re-clip the popover and re-introduce H-01) by recording *why* the scroll lives on the inner wrapper.

**Contract**: In `GameDialog.tsx`, a comment above `DialogContent` explaining: the popover portals into `DialogContent` for `react-remove-scroll` wheel support; `DialogContent` is `fixed` + `transform` so it is the popover's containing block; if it also owns `overflow-y-auto` it clips the popover, and the platform field sits near the dialog bottom so the dropdown is cut off — keep the scroll on the inner wrapper. Reference H-01 / GitHub #22. In `PlatformCombobox.tsx`, update the `container` rationale comment to point at that structure (popover must stay portalled into the un-clipped `DialogContent`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Existing tests pass: `npm run test`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Add dialog ("Add a game"): opening the platform combobox shows the dropdown **fully visible, not clipped** (it may open up or down — whichever has room).
- Edit dialog (pencil on a row): same — fully visible, with the full field set present.
- Wheel-scrolling within the option list still works (in-dialog portal preserved).
- The form still scrolls when it exceeds the viewport (e.g. edit dialog with all fields on a short window), and the dialog stays within ~90dvh.
- Mobile / short viewport (e.g. DevTools device toolbar, iPhone SE landscape ~375×667 and a short height): the list is fully visible / scrolls internally — never cut off by the dialog edge.
- The "Create “<query>”" action and selecting an existing option both still work and close the popover.
- Sanity-check the play-status `Select` in the edit dialog on mobile — confirm it is not clipped (no change expected; note if it is, as a follow-up).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation from the human that the desktop **and mobile** manual testing was successful before considering the change done.

---

## Testing Strategy

### Unit Tests:

- None added — no component/DOM test harness exists, and the change is presentation-only CSS/props. Existing `src/lib/**` vitest suites must continue to pass.

### Manual Testing Steps:

1. `npm run dev`, sign in, open Library.
2. Click "Add game" → open the platform combobox → confirm it is fully visible (not cut off), up or down.
3. Type a non-existent platform → confirm the "Create …" row appears and selecting it works.
4. Open an existing entry's edit dialog (pencil) → open the platform combobox → confirm fully visible; confirm the form scrolls if it overflows the viewport.
5. Toggle DevTools device toolbar to a small/short viewport (portrait and landscape) → repeat steps 2 and 4 → confirm no clipping; list scrolls internally when space is tight.
6. Sanity-check the play-status Select on mobile in the edit dialog.

## Performance Considerations

None — presentation-only change; no new renders, requests, or dependencies.

## Migration Notes

None — no data or schema impact.

## References

- Change identity: `context/changes/fix-platform-combobox-clipping/change.md`
- Root-cause files: `src/components/library/GameDialog.tsx` (scroll structure), `src/components/library/PlatformCombobox.tsx`, `src/components/ui/dialog.tsx:51`, `src/components/ui/command.tsx:69`
- Portal-must-stay-inside rationale: comment above `DialogContent` in `src/components/library/GameDialog.tsx` and the `container` comment in `src/components/library/PlatformCombobox.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Move dialog scroll off the popover's portal target + guard

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Existing tests pass: `npm run test`
- [x] 1.4 Production build succeeds: `npm run build`

#### Manual

- [x] 1.5 Add dialog: platform combobox fully visible, not clipped (up or down)
- [x] 1.6 Edit dialog: platform combobox fully visible; form scrolls if it overflows the viewport
- [x] 1.7 Wheel-scroll within the option list still works
- [x] 1.8 Mobile / short viewport: list fully visible or scrolls internally, never cut off
- [x] 1.9 Create-new and select-existing both work and close the popover
- [x] 1.10 Play-status Select sanity-checked on mobile (no clipping)
