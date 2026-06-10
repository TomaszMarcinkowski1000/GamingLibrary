---
change_id: manual-add-and-browse
title: Add a game manually, enrich it, and browse the library
status: impl_reviewed
created: 2026-06-10
updated: 2026-06-11
archived_at: null
---

## Notes

Roadmap slice **S-01** (`context/foundation/roadmap.md`) — the first end-to-end create→enrich→display loop.

- **Outcome:** user can add a game by entering title + platform, have it auto-enriched with IGDB metadata (or saved with a "no metadata match" flag), and browse their library in a paginated view.
- **PRD refs:** US-04, FR-007, FR-008, FR-009
- **Prerequisites:** F-01 (library-entry-store, done), F-02 (igdb-metadata-enrichment, done)
- **Parallel with:** F-03
- **Risk:** Lowest-risk slice — de-risks F-01 and F-02 together through a real user capability and gives the recommender (S-07) a way to populate data without depending on the riskier photo path. Over-modeling fields the recommender doesn't yet need is the trap to avoid.
