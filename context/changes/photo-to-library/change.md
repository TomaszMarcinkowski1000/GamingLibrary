---
change_id: photo-to-library
title: Add a game via photo — identified, auto-saved, enriched entry (north star)
status: implementing
created: 2026-06-17
updated: 2026-06-17
archived_at: null
---

## Notes

Roadmap slice **S-03** (★ north star, `market-feedback` goal). Capture or upload a single-game box photo from a browser (incl. mobile camera) → system proposes game + platform → identified entry is auto-saved into the library with IGDB metadata attached; if identification fails, offer the manual-entry path instead of an auto-saved guess.

PRD refs: US-01, FR-004, FR-005, FR-006, FR-008. Binding guardrail: ≥ 90% correct game + platform identification.

Prerequisites (all done): F-01, F-02, F-03, S-01 (manual-entry fallback), S-02 (edit/delete correction path), S-09 (edition-collapse grounding). Unblocked 2026-06-13 by S-09 — grounding re-measured 92.9% ≥ 90% bar; the constraint was grounding granularity, not the vision model (vision read ~95%, latency p95 3.25s).

Open design decisions to settle in planning:
- **Strict auto-save vs. confirm-before-save UX** — recommended confirm-before-save (model proposes → user one-tap accepts/corrects via the S-02 path), since the abstain path falls back to manual entry by design.
- In-browser mobile camera-capture must work end-to-end on the four mainstream browsers (NFR), no required desktop step — validate during planning.

Reference: `context/archive/2026-06-11-photo-identification-spike/results.md`, `context/archive/2026-06-13-enrichment-match-precision/`.
