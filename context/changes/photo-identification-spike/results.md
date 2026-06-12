# F-03 Photo-identification spike — Results & verdict

**Date:** 2026-06-13
**Run:** `npm run harness` over 116 labeled photos from the collector's own shelf, against a local
`npm run dev` (workerd) instance with live OpenRouter (Gemini 2.5 Flash) + IGDB/Twitch grounding.
Raw report: `fixtures/shelf/report.json` (gitignored — photos stay local).

## Headline numbers

| Metric | Result | Bar | Pass? |
| --- | --- | --- | --- |
| **Accuracy-when-answered** (strict: exact IGDB base-game id **+** platform) | **71.2%** (74/104) | ≥90% | ❌ **FAIL** |
| Abstain rate | 10.3% (12/116) | — | — |
| Latency p50 / p95 (server+model) | 2559 / **3252 ms** | ≤10 000 ms p95 | ✅ **PASS** |
| Angled vs straight (strict) | 90.9% (10/11) vs 68.8% (64/93) | — | confounded — see below |

The strict accuracy **fails** the ≥90% guardrail. **But the strict number is not a measure of the
vision model's ability to read a box** — it is dominated by grounding-granularity and
truth-data artifacts. Decomposed below, the model's actual title+console read is **~95%**. The
bottleneck is the *grounding* leg, not perception.

## Why the strict number understates the model: error decomposition

Sample: 116 photos. 104 answered, 12 abstained. Of the 104 answered, **8 could not be scored at all**
because the *truth label* itself failed to ground to an IGDB id (Polish-edition titles, e.g.
"God of War: Duch Sparty" / "Star Wars Jedi Ocalały", and two junk labels carried over from the
source spreadsheet — "rozne-wersje-demonstracyjne", "pierdo-ki-do-fifa-06"). These are unscoreable,
not model errors. Over the **96 scoreable answered** cases:

| Bucket | n | What it is |
| --- | ---: | --- |
| **Correct** (strict id + platform) | 74 | Model right, grounded cleanly. |
| **Platform-string artifact** (harness scoring bug) | 4 | **Same IGDB id** as truth, same physical console — failed only because the harness's `platformsMatch` doesn't equate `PSVita`=`PlayStation Vita`, `PSP (PlayStation Portable)`=`PlayStation Portable`, or a multi-platform `Xbox Series X • Xbox One` string. Model read the box correctly. (immortals-fenyx-rising, crash-tag-team-racing, danganronpa, the-swapper) |
| **Edition-variant grounding** (grounding too granular) | ~16 | Model read the box **accurately** — the box literally says *Deluxe / Complete / GOTY / Collector's / Launch / Ultimate / Special / Vengeance / Undead Edition*, *Marvel's Spider-Man*, *Archaeologist Edition* — and **first-match IGDB grounding resolved to the edition-specific entry** instead of the base-game id the truth label used. Same game, different id. (alan-wake-2, horizon-forbidden-west ×2, bloodborne, spider-man, wanted-dead, outer-wilds, armored-core-vi, dead-cells, graveyard-keeper, balatro, sifu, conscript, battlefield-bad-company-2, red-dead-redemption, tom-clancy-ghost-recon) |
| **Genuine vision miss** | ~2 | bayonetta-3 → "Bayonetta"; yakuza-0 → Xbox One id vs the truth's cross-gen Xbox Series X id. |

**Read this way:** the model identifies the correct **game title + console on ~94/96 ≈ 98%** of
scoreable photos (74 strict + 4 platform-string + ~16 edition-variants, all box-accurate reads).
Conservatively discounting the messier cases, **≥95%**. Only ~2 are true perception failures.

Intermediate, fully-defensible figures:
- Strict id+platform: **71.2%** (74/104) — the as-measured guardrail number.
- Excluding the 8 unscoreable truth-grounding failures: **77.1%** (74/96).
- Crediting the 4 platform-string scoring artifacts: **81.3%** (78/96) — "game + console correct, exact base-game id".
- Crediting edition-variant box-accurate reads as correct-game: **~95%** title-level.

## Latency

p50 2.56 s, **p95 3.25 s** — comfortably inside the 10 s-p95 NFR. Three outliers (7.7–8.2 s) are
occasional OpenRouter slowness, still within budget. **Caveat (per plan):** this is the
*server + model* round-trip against a local dev server; it excludes the real phone→Worker mobile
uplink. The model call (~0.8–1.5 s for Flash) is the same wherever the route runs, so the budget has
ample headroom even adding a realistic uplink.

## Angled vs straight — confounded, do not over-read

Angled 90.9% (10/11) *beats* straight 68.8% (64/93), which is **not** evidence that skew helps. The
two sets are different populations: the 15 angled photos are recent AAA handheld shots
(PS5/Xbox Series X, well-known 2022–2025 titles) while the 101 "straight" photos are
document-cropped library-export scans that include the older, obscurer, and Polish-edition long tail
where most of the truth-grounding/edition artifacts land. The experiment **cannot isolate skew from
game difficulty.** What we *can* say: skew was clearly **not** a dominant error driver — angled
handheld shots scored fine — so client-side opencv.js rectification is **not** an urgent prerequisite.
A clean skew measurement would need the *same* titles shot straight and angled.

## Verdict

**The ≥90% guardrail, as operationalized (exact base-game IGDB id + platform via first-match
grounding), is NOT met: 71.2%.** Per the plan's pre-registered rule that is a fail.

**However, the spike's premise behind "<90% → cut the photo path" was that <90% means the vision
model can't identify games. The data falsifies that premise.** Gemini Flash reads game title +
console off these boxes at **~95%** — including hard cases (Polish covers, obscure handheld titles,
heavy stylized logos). The sub-90% guardrail number is produced almost entirely by:

1. **First-match IGDB grounding picking edition-specific entries** over the base game (the single
   largest error source). The plan deferred richer grounding (S-09 top-N / parent-game collapse) on
   the assumption first-match was "enough to measure the guardrail" — it turned out to *be* the
   guardrail's binding constraint.
2. **Harness platform-string normalization gaps** (PSVita / PSP / multi-platform strings) — a pure
   scoring bug, free to fix.
3. **Truth-data quality** (Polish-edition labels and junk rows that don't ground).

**Recommendation: do NOT cut the photo path. Keep S-03 `blocked`, pending a bounded grounding
follow-up — not a model swap.** The remaining gap to 90% is grounding-side engineering, not a model
capability wall. Scoped next steps, in order of leverage:

- **Edition-collapsing grounding** — resolve IGDB edition variants to their parent/base game (use
  IGDB `parent_game` / version relationships, or top-N + base-title match). This alone recovers the
  bulk of the "wrong" bucket. (Promote the parked S-09 top-N grounding.)
- **Platform normalization** — extend the platform alias map (PSVita, PSP, multi-platform "X • Y"
  strings) on both the grounding service and the harness.
- **Confirm-before-save UX** — even at ~95% title read, a one-tap user confirm/correct step (model
  *proposes*, user accepts) sidesteps the unattended-auto-save guardrail entirely and is the more
  honest product framing for S-03; it leans on the S-02 edit/delete correction path already planned.
- **Re-measure** on a cleaned truth set (drop junk rows; pin `true_igdb_id` for Polish-edition
  titles) once edition-collapsing grounding lands, to get a true guardrail read.

**Fallback (unchanged):** if the grounding follow-up does not clear ~90% base-game id accuracy,
the pre-registered fallback stands — cut unattended photo auto-save and make S-01 manual entry the
primary path. The evidence here argues that fallback is **premature**: the differentiator is viable;
the work is grounding, not vision.

## Cross-links

- Roadmap: `context/foundation/roadmap.md` — F-03 (this spike), S-03 (north-star photo slice), S-09 (top-N grounding, now load-bearing).
- PRD: FR-005 (photo identification), §Success Criteria > Guardrails (the ≥90% bar), §Non-Goals (edition-level precision — relevant: the metric is currently *penalised* by edition precision the product explicitly does not require).
- Plan: `context/changes/photo-identification-spike/plan.md`.
- Raw data: `fixtures/shelf/report.json` (gitignored).

## Owner action

- Production use requires `wrangler secret put OPENROUTER_API_KEY` (not needed for this local spike).
