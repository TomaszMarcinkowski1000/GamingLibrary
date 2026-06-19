---
change_id: fix-decimal-game-length
title: Allow saving decimal game length (e.g. 42.5h) in add/edit form
status: implemented
created: 2026-06-19
updated: 2026-06-19
archived_at: null
---

## Notes

Roadmap v1 Hardening H-02 (GitHub #23), type: bug, area: Add/Edit form + validation.

Symptom: IGDB returns decimal lengths (e.g. `42.5`), but the "Length (hours)" input only accepts integers, so the edit can't be saved.

Root cause: DB (`length_hours numeric`) and zod (`z.number().min(0)`) both accept decimals; the form `<Input type="number">` has no `step`, so HTML5 defaults to `step="1"` and rejects decimals (`GameFormFields.tsx:196-205`).

Fix sketch: Add `step="any"` to the length input; confirm float parsing.
