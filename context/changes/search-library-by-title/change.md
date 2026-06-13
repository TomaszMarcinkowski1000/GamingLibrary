---
change_id: search-library-by-title
title: Search the library by title to check ownership before buying
status: planned
created: 2026-06-13
updated: 2026-06-13
archived_at: null
---

## Notes

Roadmap slice **S-05** (`context/foundation/roadmap.md`), Stream A (Library core).

Outcome: user can type a title substring (case-insensitive) and see only matching
entries — the fast "do I already own this?" check that covers the secondary success
criterion (in-store / marketplace duplicate-purchase avoidance).

- PRD refs: US-05, FR-012
- Prerequisites: F-01, S-01 (both done)
- Parallel with: S-02, S-03, S-04
- Risk: low — split out from filter/sort (S-06) because it has independent product
  value and needs nothing beyond a populated library, so it can ship well before the
  status-dependent filters.
