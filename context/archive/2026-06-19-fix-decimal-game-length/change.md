---
change_id: fix-decimal-game-length
title: Allow saving decimal game length (e.g. 42.5h) in add/edit form
status: archived
created: 2026-06-19
updated: 2026-06-19
archived_at: 2026-06-19T18:55:48Z
---

## Notes

Roadmap v1 Hardening H-02 (GitHub #23), type: bug, area: Add/Edit form + validation.

Symptom: IGDB returns decimal lengths (e.g. `42.5`), but the "Length (hours)" input only accepts integers, so the edit can't be saved.

Root cause: DB (`length_hours numeric`) and zod (`z.number().min(0)`) both accept decimals; the form `<Input type="number">` has no `step`, so HTML5 defaults to `step="1"` and rejects decimals (`GameFormFields.tsx:196-205`).

Fix (shipped): Rather than make the form accept decimals, ceil IGDB-derived length up to whole hours at the mapping source (`lengthHoursFromSeconds` in `src/lib/services/igdb.ts`). Sub-hour precision carries no library value and the integer-only input then never trips. No form, zod, schema, or migration changes (DB had no decimal rows).
