---
change_id: testing-route-contracts-isolation
title: API route contracts + cross-user isolation (test rollout Phase 3)
status: implemented
created: 2026-07-25
updated: 2026-07-25
archived_at: null
---

## Notes

Open a change folder for rollout Phase 3 of context/foundation/test-plan.md: "API route contracts + cross-user isolation".
Risks covered: #5 (cross-user library exposure — IDOR/RLS gap: a request authenticated as user A reads, mutates, or deletes user B's entry, or search/filter/recommend returns another user's rows), #6 (input-boundary regressions in the add/edit path — a decimal length rejected, a platform alias stored un-normalized, or client/server validation parity drifting). Test types planned: integration.
Risk response intent:
- #5: prove a request authenticated as user A is rejected (or returns empty) for user B's resource id across GET / PUT / DELETE — "an RLS policy exists" is not "the route enforces ownership"; avoid testing only the logged-in happy path.
- #6: prove a decimal length saves, platform aliases normalize, and the server rejects what the client rejects — "client-side validation is enough" is the assumption to break; avoid mirroring the implementation's own validation constants instead of the FR/spec.
Note for research scope: §6.6's Phase 2 mutation pass found getRecommendations' Supabase boundary uncovered by any layer, and listAllEntries has no test anywhere in the repo — both are Phase 3 surface.
