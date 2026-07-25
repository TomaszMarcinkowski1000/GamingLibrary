---
change_id: testing-grounding-identify-seam
title: Grounding & identify-seam integration tests (test-plan Phase 1)
status: archived
created: 2026-07-18
updated: 2026-07-25
archived_at: 2026-07-25T16:52:12Z
---

## Notes

Rollout Phase 1 of context/foundation/test-plan.md: "Grounding & identify-seam integration".

Risks covered:
- #1 — photo path attaches wrong game/edition/metadata, or a thin/ambiguous read false-positives instead of abstaining, and the auto-saved entry is silently trusted.
- #2 — identify orchestration mis-assembles: un-normalized platform/title reaches grounding, or a no_match/abstain still auto-saves a guess instead of routing to manual entry.

Test types planned: integration + unit.

Risk response intent:
- #1: Prove that a read resolving to an edition variant collapses to the base-game id, and a thin/ambiguous read yields no_match rather than attaching wrong metadata. Use the S-09 shelf sample as an independent oracle, not whatever IGDB currently returns.
- #2: Prove that an abstain/no_match routes to manual entry and does NOT auto-save; normalization runs before grounding; the error path fails cleanly without leaking provider keys or raw upstream errors.
