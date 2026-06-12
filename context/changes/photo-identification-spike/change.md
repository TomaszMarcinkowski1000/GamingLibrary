---
change_id: photo-identification-spike
title: Photo-identification spike — vision game+platform ID + ≥90% accuracy validation
status: impl_reviewed
created: 2026-06-11
updated: 2026-06-13
archived_at: null
---

## Notes

Roadmap F-03 (`context/foundation/roadmap.md`). Foundation spike: a server-side vision call that, given a single-game box photo, returns a proposed game title + platform — plus a thin accuracy harness run against a sample of the collector's own shelf to measure the **≥90% guardrail** (the binding pass/fail for FR-005).

PRD refs: FR-005, Success Criteria > Guardrails (≥90% accuracy), NFR (identification within 10s p95 on mobile broadband).

Unblocks S-03 (photo-to-library, the north star) and resolves the `external` top-blocker — this is the single cheapest experiment that tells us whether v1's photo path is viable. If accuracy < 90%, the photo path is cut and S-01 manual entry becomes primary.

Key unknowns (from roadmap):
- Vision-provider API key (OpenRouter or equivalent) must be plumbed in (`env.schema`, `.dev.vars`, Worker secret) — Owner: user. Block: no.
- **Does the chosen vision model identify game + platform at ≥90% on the collector's own shelf?** — Owner: user/team. Block: yes (binding guardrail).
- Latency (10s p95) is a secondary risk measured here.
