---
change_id: fix-platform-combobox-clipping
title: Fix platform combobox opening upward and being clipped in add/edit dialog
status: implemented
created: 2026-06-19
updated: 2026-06-20
archived_at: null
---

## Notes

Roadmap v1 Hardening H-01 (GitHub #22), type: bug, area: Add/Edit dialog.

Symptom: In the "Add manually" / edit dialog, the platform combobox dropdown opens upward and is cut off. Previously fixed; regressed after a later change.

Root cause: `PlatformCombobox.tsx` `<PopoverContent>` has no `side`/`avoidCollisions` control, so Radix auto-flips to `side="top"` near the top of the scroll container; `GameDialog`'s `DialogContent` (`overflow-y-auto`) then clips the upward popover.

Files: `src/components/library/PlatformCombobox.tsx`, `GameDialog.tsx`, `ui/popover.tsx`.

Fix sketch: Force `side="bottom"` and/or portal the popover outside the scroll clip (it accepts a `container`); guard against re-regression.
