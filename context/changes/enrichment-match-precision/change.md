---
change_id: enrichment-match-precision
title: "Precise IGDB grounding: collapse edition variants + suppress false positives"
status: planned
created: 2026-06-13
updated: 2026-06-13
archived_at: null
---

## Notes

Roadmap slice **S-09** (`context/foundation/roadmap.md`) — promoted from `optional` to **load-bearing** by the F-03 spike (2026-06-13): it is the binding prerequisite between the proven ~95% vision read and a shippable north-star **S-03**.

Two fronts:
1. **Edition-variant collapse** — a box read as "Alan Wake II Deluxe Edition" / "Horizon Forbidden West Complete Edition" / "Bloodborne GOTY" / "Marvel's Spider-Man" should ground to the **base-game** IGDB id, not the edition-specific entry (via `parent_game`/`version_parent` relationships or top-N + base-title match). This is the dominant F-03 guardrail-miss source.
2. **False-positive suppression** — thin/ambiguous search terms (e.g. title "e" on "Xbox Series X") should degrade to the existing `no_match` flag instead of attaching wrong metadata. Surfaced during S-01 manual verification (2026-06-11).

Platform-alias normalization (PSVita/PSP/multi-platform strings) rides along.

**PRD refs:** FR-005 (photo identification — the ≥90% guardrail is grounding-bound per F-03), FR-008 (eager enrichment quality).
**Prerequisites:** F-02, S-01 — both done.

**Acceptance check:** a re-run of the F-03 harness on a cleaned truth set should clear ~90% base-game id accuracy. The F-03 shelf sample (failures already enumerated by case) bounds the work and validates both fronts: `context/changes/photo-identification-spike/results.md` (archived → `context/archive/2026-06-11-photo-identification-spike/`).

**Risk:** over-collapsing (merging genuinely distinct titles) or mis-tuning the false-positive threshold and dropping valid matches.
