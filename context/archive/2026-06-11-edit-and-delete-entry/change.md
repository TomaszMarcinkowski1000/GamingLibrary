---
change_id: edit-and-delete-entry
title: Edit any field of a library entry, and delete it behind a confirmation step
status: archived
created: 2026-06-11
updated: 2026-06-12
archived_at: 2026-06-12T21:30:50Z
---

## Notes

Roadmap slice **S-02** (`context/foundation/roadmap.md`). PRD refs: FR-010, FR-011, FR-020. Prerequisites F-01, S-01 (both done).

**Outcome:** user can edit any field of a library entry after creation, and delete an entry behind a confirmation step.

**Why it's sequenced here:** it's the correction path the photo auto-save (S-03 / FR-006) depends on — S-03 auto-saves identifications and relies on edit/delete to fix the ≤10% it gets wrong. Building it before S-03 keeps the north star's acceptance criteria satisfiable.

**Design note (from S-01 planning, 2026-06-10):** implement edit as an **expansion of S-01's add dialog into a unified add/edit dialog**, not a separate edit screen. S-01 ships `AddGameDialog` with its form body factored into a reusable, mode-extensible `GameFormFields` component (title + platform only at add); S-02 grows that body to all editable fields and adds an UPDATE path (the F-01 RLS update policy already exists). This also lets S-01's post-save seam swap to "reopen the just-saved entry in edit mode for review/correction."

**Watch the S-04 overlap:** `play_status` is editable here but S-04 (mark-play-status) owns that capability — decide during planning whether play-status lives in the dialog, inline on the list, or both, so the two slices don't build it twice.
