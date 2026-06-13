---
change_id: enrichment-match-precision
title: "Precise IGDB grounding: collapse edition variants + suppress false positives"
status: archived
created: 2026-06-13
updated: 2026-06-13
archived_at: 2026-06-13T17:48:31Z
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

**Acceptance result (2026-06-13):** re-measure reached **92.9% accuracy-when-answered (92/99), PASS** (≥90% bar) — up from F-03's 71.2% — with abstain rate down to **13.2%** (from 24.6% mid-run). Latency p95 8.8s (≤10s NFR), angled 100% / straight 92.0%. Truth set cleaned per `fixtures/shelf/README.md` (dropped 2 junk rows; pinned 5 Polish-edition ids; corrected 4 Yakuza cross-gen labels to Xbox One).

Two grounding fixes landed in Phase 4, both surfaced by the per-case harness decomposition:
1. **PC-media platform alias** (`PC DVD`/`PC DVD-ROM` → PC) — closed 3 id-correct/platform-string artifacts.
2. **Platform-aware collapse** — `collapseToBaseGame` now only follows a `version_parent`/`parent_game` relation when the related base still covers the query platform. `parent_game` also links remakes/remasters/ports to their *original* (on older consoles); collapsing onto that and then platform-vetoing it was a recall regression (the plan forbids it). The guard recovered ~10 remakes (Dead Space, Super Mario RPG, OoT 3D, DDLC+, DKC Returns HD, Crash Tag Team Racing, …) into correct answers and fixed an RDR2 over-collapse, while editions still collapse to base.

Residual misses are truth-data/IGDB-hierarchy quirks (RDR/RDR2/dead-cells edition granularity, halo-wars-2 & "Dead Space Remake" label cross-gen/naming) + 1 genuine vision miss (bayonetta-3) — not grounding-logic failures.

**Risk:** over-collapsing (merging genuinely distinct titles) or mis-tuning the false-positive threshold and dropping valid matches.
