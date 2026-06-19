---
change_id: fix-platform-combobox-clipping
title: Fix platform combobox opening upward and being clipped in add/edit dialog
status: archived
created: 2026-06-19
updated: 2026-06-20
archived_at: 2026-06-19T22:34:48Z
---

## Notes

Roadmap v1 Hardening H-01 (GitHub #22), type: bug, area: Add/Edit dialog.

Symptom: In the "Add manually" / edit dialog, the platform combobox dropdown opens upward and is cut off. Previously fixed; regressed after a later change.

Root cause: the popover is portaled into `DialogContent`, which itself carried the `overflow-y-auto` scroll clip — so the popover was clipped by the very element it rendered into, regardless of which side Radix chose.

Files: `src/components/library/GameDialog.tsx`, `src/components/library/PlatformCombobox.tsx`.

Fix: Move the scroll clip off the popover portal target — keep `DialogContent` plain and wrap its children in a separate `overflow-y-auto` scroll container. Guarded against re-regression. (An earlier `side="bottom"` / re-portal approach was implemented and failed — see the 2026-06-20 re-plan note in plan.md.)
