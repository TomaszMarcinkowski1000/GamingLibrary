# Fix Platform Combobox Clipping (Add/Edit Dialog) — Plan Brief

> Full plan: `context/changes/fix-platform-combobox-clipping/plan.md`

## What & Why

In the add/edit game dialog, the platform combobox dropdown opens **upward and is cut off** (Roadmap v1 Hardening H-01, GitHub #22). It was fixed before and regressed. This plan forces the popover to open downward and bounds its height so it never clips, on desktop or mobile.

## Starting Point

`PlatformCombobox`'s Radix popover is portalled **into** the dialog content (intentionally — portalling to `<body>` makes `react-remove-scroll` swallow wheel-scroll). But `DialogContent` is `position: fixed` with a centering `transform` **and** `overflow-y-auto`; the transform makes it the containing block for the `fixed` popover, so the dialog's overflow clips it. With no `side`/`avoidCollisions` set, Radix flips the popover upward into that clip.

## Desired End State

Opening the platform combobox in the add and edit dialogs — on desktop and mobile/short viewports — shows the dropdown opening downward, fully visible. When space below the trigger is tight, the list shrinks and scrolls internally instead of clipping. Wheel-scroll in the list still works.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Fix strategy | Force `side="bottom"` + `avoidCollisions={false}`, keep in-dialog portal | Deterministic one-component fix that preserves the wheel-scroll portal | Plan |
| Mobile handling | Cap list height to `min(300px, --radix-popover-content-available-height)` | Short viewports shrink-and-scroll the list instead of clipping | Plan (user-added) |
| Scope | `PlatformCombobox` only; sanity-check play-status Select | Matches the H-01 report, lowest risk | Plan |
| Re-regression guard | Load-bearing code comment + manual check | No component/DOM test harness exists; comment prevents prop-stripping | Plan |
| Residual edge case | Handled via the height cap (not just accepted) | User asked mobile be covered in fix + testing | Plan (user-added) |

## Scope

**In scope:** `side="bottom"` + `avoidCollisions={false}` on the platform `PopoverContent`; viewport-relative list height cap; guard comment.

**Out of scope:** re-portalling to `<body>`; restructuring shared `DialogContent`; changing the play-status Select; new test infra.

## Architecture / Approach

Single component change in `src/components/library/PlatformCombobox.tsx`: add the two placement props to `PopoverContent`, override `CommandList`'s `max-h` with `min(300px, var(--radix-popover-content-available-height, 300px))`, and add a comment recording why these are load-bearing. The in-dialog portal (`container`) is unchanged.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Force downward popover + bound height + guard | Downward, non-clipping popover on all viewports + guard comment | Radix available-height var being `0`/unset collapsing the list — mitigated with a CSS fallback |

**Prerequisites:** none — local dev (`npm run dev`) + a browser with device-toolbar for mobile checks.
**Estimated effort:** ~1 short session, single file.

## Open Risks & Assumptions

- Assumes `--radix-popover-content-available-height` is populated correctly inside the transformed container; mitigated by the `min(...)` + fallback and manual mobile verification.
- Assumes the platform field stays near the top of the dialog (field #2); if future layout changes push it down, the height cap still prevents clipping.

## Success Criteria (Summary)

- Platform combobox opens **downward** and is never cut off in add or edit dialogs, on desktop and mobile.
- The option list scrolls internally when space is tight; wheel-scroll still works.
- `npm run typecheck`, `lint`, `test`, and `build` all pass.
