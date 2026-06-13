# Precise IGDB Grounding — Plan Brief

> Full plan: `context/changes/enrichment-match-precision/plan.md`
> F-03 spike results (enumerated failure set): `context/archive/2026-06-11-photo-identification-spike/results.md`

## What & Why

IGDB grounding currently picks the **first** search hit, which for an edition box ("Alan Wake II
Deluxe Edition", "Bloodborne GOTY") lands on the edition-specific entry instead of the base game. The
F-03 spike measured the photo vision read at ~95% but strict base-game id+platform grounding at only
**71.2%** — the gap is grounding, not vision. This slice (roadmap **S-09**) closes that gap so the
north-star photo slice **S-03** can clear its ≥90% guardrail; it also lifts S-01 manual-add
enrichment quality, since both paths share one grounding function.

## Starting Point

`lookupGameMetadata` (`src/lib/services/igdb.ts:146`) runs a single
`search(title).where(platform).limit(1).first()`. The IGDB wrapper already exposes `parent_game`,
`version_parent`, `category`, and popularity fields on `Game`, and the query builder supports top-N
fetches — so the fix needs no schema work. The platform map has located alias gaps (`psvita`,
multi-platform strings) and is hand-duplicated in the harness. There are no unit tests on the
grounding code today.

## Desired End State

Edition boxes ground to the **base-game** id; thin/ambiguous terms (title "e" on Xbox Series X)
degrade to `no_match` instead of attaching wrong metadata; platform aliases resolve correctly. Recall
never regresses below today except where false-positive suppression deliberately fires. A local
`npm run harness` re-run on a cleaned truth set reaches **~90%** base-game id+platform accuracy.

## Key Decisions Made

| Decision                  | Choice                                                          | Why (1 sentence)                                                                 | Source |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| Edition collapse strategy | Hybrid: IGDB relations first, base-title match fallback         | Covers both well-linked editions and the name-based cases IGDB doesn't link.     | Plan   |
| False-positive signal     | Composite: name similarity + platform agreement + popularity    | Layered defense matches the roadmap's named signals; resilient to weak signals.  | Plan   |
| Platform normalization    | Expand alias map + parse multi-platform strings (any-overlap)   | Fixes both the grounding filter and the 4 harness platform-string artifacts.     | Plan   |
| Testability               | Extract pure functions (collapse/scorer/platform), unit-test    | Fast deterministic tests with no network; mirrors igdb.ts's pure-helper style.   | Plan   |
| Base metadata source      | Inline-expand relations in top-N query; by-id follow-up if needed | Usually zero extra round-trips; enrichment reflects the true base game.        | Plan   |
| No-confident-base fallback| First-match id, unless FP gate fires → `no_match`              | Precision-only change; never regresses recall except where suppression intended. | Plan   |
| Result contract           | Keep `matched \| no_match` unchanged; defer confidence to S-03  | Smallest blast radius; both consumers stay untouched.                            | Plan   |

## Scope

**In scope:** top-N grounding rewrite, edition collapse, composite false-positive suppression,
platform-alias normalization (+ harness mirror), extracted pure functions + unit tests, harness
collapse-debug + truth-set cleaning docs, manual acceptance re-measure.

**Out of scope:** `IgdbLookupResult` contract change, confirm-before-save UX, persistence/S-03 work,
client-side image rectification, vision/model changes, a committed truth-set cleaning script, fuzzy
platform resolver, consumer re-architecture.

## Architecture / Approach

`lookupGameMetadata` becomes a thin orchestrator: **fetch top-N candidates** (with inline-expanded
base-relation fields) → **`collapseToBaseGame`** (relations-first, title-match fallback) →
**`isConfidentMatch`** composite gate (else `no_match`) → existing field mapping against the base
game. The tuning surface lives in pure functions unit-tested against fixtures derived from the F-03
enumerated failure cases. Both consumers (`api/identify`, `library`) inherit the fix unchanged.

## Phases at a Glance

| Phase                              | What it delivers                                            | Key risk                                              |
| ---------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| 1. Platform-alias normalization    | psvita/psp/multi-platform resolution + harness mirror       | Map duplication drift between service and harness      |
| 2. Edition-variant collapse        | Top-N fetch + base-game collapse + base metadata            | Over-collapsing genuinely distinct titles              |
| 3. False-positive suppression      | Composite gate degrading thin terms to `no_match`           | Mis-tuned threshold dropping valid (short-title) matches |
| 4. Harness + truth-set + re-measure| Collapse debug, cleaning docs, ~90% acceptance run          | Gitignored local-only photos — re-measure is manual    |

**Prerequisites:** F-02 + S-01 (both done); local shelf photos + `labels.csv` and live
OPENROUTER/TWITCH creds for the manual re-measure.
**Estimated effort:** ~2–3 sessions across 4 phases (Phases 2–3 carry the tuning iteration).

## Open Risks & Assumptions

- **Over-collapse** (merging distinct titles) and **threshold mis-tuning** (dropping valid matches)
  are the two named risks; the F-03 enumerated failure set bounds and validates both.
- **Assumption:** the wrapper expands `parent_game`/`version_parent` nested fields inline — Phase 2
  verifies and falls back to a by-id fetch if not.
- The acceptance re-measure depends on local-only gitignored shelf data; CI sees only the unit tests.

## Success Criteria (Summary)

- Edition boxes ground to the base-game id; thin terms abstain instead of attaching wrong metadata.
- Pure collapse/scorer/platform functions are unit-tested green; lint + typecheck + build pass.
- Local `npm run harness` on a cleaned truth set reaches ~90% base-game id+platform accuracy, p95 < 10s.
