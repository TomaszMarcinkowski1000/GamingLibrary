---
change_id: testing-recommender-behavior-hardening
title: Recommender behavior hardening — test-plan rollout Phase 2
status: complete
created: 2026-07-25
updated: 2026-07-25
archived_at: null
---

## Notes

Rollout Phase 2 of context/foundation/test-plan.md: "Recommender behavior hardening".

Risks covered: #4 — the recommender ranks wrong (length bucket ignored, a 100%-completed game surfaces outside comfort mode, ordering is non-deterministic, or an empty list appears instead of an explained empty-state).

Test types planned: unit (pure scoring function, no I/O).

Risk response intent: prove that bucket-edge values (exactly 10h / 30h), 100%-complete de-prioritization, deterministic ordering, and the empty-state *reason* all hold. The behavior to protect is business/user-facing ranking correctness, not "the happy-path top rank is correct." The oracle must come from the FR/business rule (FR-015/016/018, US-03), never from the scoring code under test.
