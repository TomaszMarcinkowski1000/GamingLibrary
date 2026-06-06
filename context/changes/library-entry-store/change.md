---
change_id: library-entry-store
title: Library-entry store — user-isolated entry table, RLS, and shared entry type
status: implemented
created: 2026-06-06
updated: 2026-06-06
archived_at: null
---

## Notes

Roadmap item **F-01** (foundation) from `context/foundation/roadmap.md`.

Outcome: the smallest persistent, user-isolated library-entry store — one entry table
carrying the user-facing fields (title, platform, play status, date-added, and the IGDB
metadata fields), per-user RLS policies, and a shared entry type in `src/types.ts`.
Nothing user-facing on its own.

- PRD refs: NFR (per-user isolation; persistence), Access Control (single-tenant, login-gated)
- Prerequisites: none (auth + DB connection present per Baseline)
- Unlocks: S-01..S-07 (every slice reads or writes the library)
- Risk/trap: over-modeling fields the recommender doesn't yet need. Keep minimal —
  one table + RLS, not a full data layer; S-01 exercises the columns through a real create/read.
