---
change_id: mark-play-status
title: Mark a game with a play status (+ optional play time)
status: planned
created: 2026-06-13
updated: 2026-06-13
archived_at: null
---

## Notes

Roadmap slice S-04 (`mark-play-status`).

Outcome: user can set, change, or clear a play status ("Playing now", "Played", "Completed", "100% completed") on a library entry, and optionally record play time in hours; changes reflect without a full page reload.

PRD refs: US-02, FR-013, FR-014. Prerequisites: F-01, S-01 (both done). Parallel with S-02, S-03, S-05.

Load-bearing downstream: S-06 (status filter) and S-07 (recommender) both consume play status. Watch the S-02 overlap — the edit/delete dialog already touches `play_status`; the S-02 design note flagged deciding whether play-status lives in the dialog, inline on the list, or both. Align with that so the capability isn't built twice. FR-014 (play time) is the slice's only nice-to-have.
