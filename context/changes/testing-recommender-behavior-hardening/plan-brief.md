# Recommender Behavior Hardening — Plan Brief

> Full plan: `context/changes/testing-recommender-behavior-hardening/plan.md`
> Research: `context/changes/testing-recommender-behavior-hardening/research.md`

## What & Why

Rollout Phase 2 of the test plan, covering Risk #4 — *the recommender ranks wrong*. The
recommender is the product's reason to exist (PRD §Business Logic), and research found it
**largely already protected**: 30 existing unit tests, verified green, already cover bucket
edges, 100%-complete handling, determinism, and the engine's empty-state branches. So this phase
does not re-assert covered ground. It closes the one genuine gap — proving the **user** is told
which constraint excluded everything, not just that the engine computed a `reason` — and
replaces three code-shaped oracles with spec-shaped ones.

## Starting Point

`recommend()` is a pure function with every helper already exported for testing, and
`recommendation.test.ts` exercises it well. Two things are missing. First, the human sentence
naming the excluding constraint lives in an unexported function in Astro frontmatter
(`play-next/index.astro:53-62`) with zero tests, and Vitest cannot import `.astro` at all.
Second, several existing assertions pin the *current code* rather than the *rule*: they assert
100%-complete games are absent (the code excludes; the PRD says de-prioritize), and they assert
the specific `created_at → id` tie-break (the PRD mandates determinism, not that key).

## Desired End State

`npm test` green with a new copy suite proving each of the three exclusion causes yields a
distinct sentence that names its own constraint, plus three engine assertions written from the
PRD. Both source files have been through one triaged Stryker pass. Test-plan §6.5 carries the
recommender cookbook and §6.7 the Phase-2 note. `/play-next` renders exactly as it does today.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Empty-state test layer | Extract `emptyStateMessage()` to `src/lib/services/recommendationCopy.ts` | Vitest has no Astro plugin, so exporting alone would not reach it — extraction is the only cheap layer, and it is a pure move with zero behaviour delta | Plan |
| Module home | `src/lib/services/` beside the engine | Keeps the machine `reason` and its human sentence reviewable together; a `.ts` under `src/pages/` would become a live Astro endpoint route | Plan |
| 30h boundary | Keep the test, annotate as documentation-of-behaviour | FR-016 lets both medium and long claim 30, so the code's answer is a code choice; annotating beats deleting a green regression guard | Research + Plan |
| De-prioritization | Assert direction ("never outranks"), not absence | The PRD says de-prioritized while the code excludes; the direction assertion survives a future correction of that divergence | Research |
| Determinism | Assert full-result equality across permutations | Same-input-same-output is spec; the `created_at → id` key is not | Research |
| Mutation testing | Run Stryker on both files | 30 assertions have never been probed for whether they would actually fail if the scoring broke | Plan |
| `EmptyReason` conflation | Record, do not fix | Splitting the union is a production behaviour change, out of scope per test-plan §7 (Phase 1 precedent) | Research + Plan |

## Scope

**In scope:** the extracted copy module + its suite; three spec-direction engine assertions; one
annotation on the existing 30h case; two selective Stryker runs; test-plan §6.5, §6.7 and status
sync.

**Out of scope:** fixing the `EmptyReason` conflation; changing any recommender behaviour; a new
30h assertion; the unreachable empty-bucket-selection guard; `getRecommendations()`'s I/O path;
routes, e2e and CI gates (test-plan Phases 3–5).

## Architecture / Approach

Two-layer empty-state contract, made testable without changing it: the pure engine
(`recommendation.ts`) keeps emitting `{status:"empty", reason, mode}`, and the human sentence
moves from Astro frontmatter into a sibling pure module the page imports — mirroring the existing
`playStatus.ts` extraction precedent. Everything else is additive test code against an unchanged
pure function.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Verify & annotate | Baseline confirmed; 30h case marked as behaviour, not spec | Near no-op by design — the temptation is to pad it with duplicate assertions |
| 2. Empty-state copy | Extracted module + constraint-naming suite | The only production-surface change; a wording slip during the move is a real behaviour change |
| 3. Spec-direction asserts | De-prioritization, 10h end-to-end, permutation determinism | The de-prioritization assertion is worthless unless the fixture defeats the tie-break |
| 4. Mutation pass | Triaged survivors on both files | Score-chasing that pins weight constants |
| 5. Cookbook + sync | §6.5 filled, §6.7 note, statuses flipped | Recording gaps as if they were fixes |

**Prerequisites:** none — clean `main` at `b1d2c59`, Vitest 4.1.10 and Stryker already wired.
**Estimated effort:** ~1–2 sessions; Sub-phases 1, 3 and 5 are quick, 2 and 4 carry the work.

## Open Risks & Assumptions

- The extraction assumes test-plan §7's "changes no production **behaviour**" permits a
  behaviour-preserving move. If a reviewer reads §7 as "no production file changes at all",
  Sub-phase 2 must fall back to recording the gap and the phase's real deliverable disappears.
- Stryker on a heavily-covered pure module may yield mostly consciously-ignored survivors
  (weight arithmetic that preserves the intended lexicographic ordering); the pass could end with
  few or no added assertions, which is an acceptable outcome, not a failure.
- Three spec-vs-code divergences are recorded and left unfixed. Each is a candidate for a future
  non-test change, and until then the code stays stricter or broader than the PRD.

## Success Criteria (Summary)

- A user hitting any of the three empty states is provably told *which* constraint excluded
  everything — asserted in code, not just rendered.
- The recommender's protective assertions cite the PRD, so a legitimate implementation change
  does not break them and a rule violation does.
- The next contributor can write a recommender test from §6.5 without re-deriving which boundary
  values have a spec oracle.
