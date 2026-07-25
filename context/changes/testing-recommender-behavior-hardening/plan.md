# Recommender Behavior Hardening — Implementation Plan

Rollout Phase 2 of `context/foundation/test-plan.md`. Risk covered: **#4 — the recommender
ranks wrong**. Test type: unit. Hot-spot scope: `src/` excluding `src/components/ui/`.

## Overview

Research found this phase is **largely already protected**: the existing
`src/lib/services/recommendation.test.ts` covers bucket edges, 100%-complete exclusion,
deterministic ordering, and all three engine-level empty-state branches with behavioural
(non-mirror) assertions. Verified independently for this plan: `npx vitest run
src/lib/services/recommendation.test.ts` → **30 passed** on commit `b1d2c59`.

So this phase does **not** re-assert covered ground. It does four narrow things:

1. Closes the one genuine gap — the **user-facing sentence** that names which constraint
   excluded everything (PRD §Business Logic, `prd.md:182`), which today lives untested in
   Astro frontmatter.
2. Adds three **spec-direction** assertions that protect the *rule* where the existing tests
   protect the *current code* (de-prioritization vs. exclusion; the spec-clean 10h edge
   end-to-end; determinism across permutations rather than one reversal).
3. Probes every assertion — old and new — with a selective Stryker pass, the discipline §6.6
   exists for.
4. Fills test-plan §6.5 and appends the §6.7 Phase-2 note.

## Current State Analysis

**The engine is pure and pre-hardened.** `recommend()` (`recommendation.ts:180`) takes
`(entries, request, limit)` and returns a discriminated `RecommendationResult` — no Supabase,
no clock, no RNG. The impure wrapper `getRecommendations()` (`recommendation.ts:220`) is the
only I/O boundary and stays out of unit tests. Every scoring helper is already exported "for
unit tests" (`recommendation.ts:47`).

**What the 30 existing tests already lock** (verified against the file, not the research doc):

| Risk #4 target | Existing coverage | Verdict |
|---|---|---|
| (a) bucket edges 10h / 30h | `recommendation.test.ts:37-52` — `it.each` pins 9.99→short, 10→medium, 29.99→medium, 30→long, 59.99→long, 60→very_long, null→null | Covered at **helper level only** |
| (b) 100%-complete outside comfort | `:77-89` (`isEligible` both new modes) + `:294` end-to-end `not.toContain("celeste")` | Covered — but pins **exclusion**, not the spec's "de-prioritized" |
| (c) determinism / tie-break | `:186-190` reversed-input invariance (ids only); `:192-201` `created_at` → `id` composite tie-break | Covered — one permutation, ids only |
| (d) explained empty-state | `:204-227` — all three engine branches asserted as full objects | Covered at **engine level only** |

**The gap.** The engine emits a machine `{status:"empty", reason, mode}`; the human sentence
lives in `emptyStateMessage()` at `src/pages/play-next/index.astro:53-62`, unexported, with
zero tests. `EmptyReason` has only two values (`types.ts:162`), so `mode_eligibility`
**conflates two distinct constraints** — "comfort needs a game you've played" and "everything
matching is already 100% complete" — disambiguated *only* by the `mode` field, and *only* in
that page function. Risk #4's must-challenge line states this exactly: "the engine returned
`mode_eligibility`" is not "the user was told which constraint excluded everything"
(`test-plan.md:76`).

**Why the gap costs a production-surface change.** `vitest.config.ts:20` includes
`src/**/*.test.ts` and the config registers **no Astro plugin**, so an `.astro` module is not
importable by this harness at all. Exporting `emptyStateMessage()` would not make it
reachable; only extracting it to a `.ts` module does.

**One candidate test ruled out.** `lengthDistance`'s empty-selection guard
(`recommendation.ts:75`) is unreachable from the UI: `parseRecommendationParams` falls back to
all four buckets on an empty or all-invalid selection (`validation/library.ts:110-111`), and
that fallback is already tested (`validation/library.test.ts:80`). Asserting the guard would
mirror defensive code for zero user-visible signal.

## Desired End State

`npm test` is green with the existing 30 assertions untouched in meaning, plus a new
`recommendationCopy.test.ts` proving the user is told *which* constraint excluded everything,
plus three engine assertions written against the PRD rather than the code. `recommendation.ts`
and `recommendationCopy.ts` have both been through one selective Stryker pass with every
survivor triaged. Test-plan §6.5 is filled, §6.7 carries the Phase-2 note, and §3's Phase 2 row
reads `complete`.

Verify by: `npm test` (green), `npx astro check` (clean), `npm run lint` (clean), and loading
`/play-next` in comfort mode against a library with no played games — the same sentence renders
as before the extraction.

### Key Discoveries

- **The de-prioritization guard rests entirely on one filter.** `statusPenalty` returns `1`
  only for `completed` in new modes (`recommendation.ts:115`); `completed_100` gets **`0`** —
  the best possible penalty. Nothing but `isEligible` (`recommendation.ts:92`) keeps a
  100%-complete game out of a new-mode ranking. Relax that filter and `completed_100` would
  score *better* than `completed`. This makes Sub-phase 3's de-prioritization assertion
  genuinely protective rather than tautological — see Critical Implementation Details.
- **The extraction has an in-repo precedent.** `playStatusBadgeClass` is a pure presentational
  helper already living at `src/components/library/playStatus.ts` and imported by this same page
  (`index.astro:9`). Pulling a pure helper out of `.astro` is established practice here.
- **A `.ts` file under `src/pages/` becomes an Astro endpoint route** — so co-locating the
  extracted module with the page would publish a URL as a side effect of a test refactor. It
  goes in `src/lib/services/` per CLAUDE.md ("Services/helpers go in `src/lib/`").
- **A fourth spec-vs-code divergence exists, beyond the three research listed.** FR-016
  (`prd.md:160`) and US-03 (`prd.md:80`) both define **three** length buckets (short / medium /
  long 30h+); the code ships **four** (`types.ts:104`, `very_long` at 60h+) and relabels long as
  "30–60h" (`types.ts:124`). This is the root of the 30h ambiguity: the 30h and 60h edges have
  no spec oracle at all.
- **Fixture hygiene.** `noveltyGoodness` calls `Date.parse` on input fields
  (`recommendation.ts:128,131`); a datetime string without an offset is runtime/TZ-dependent.
  Keep new fixtures date-only or ISO-with-offset, matching the existing factory's
  `"2026-01-01T00:00:00Z"` (`recommendation.test.ts:27`).

## What We're NOT Doing

- **Not fixing the `EmptyReason` two-constraint conflation.** `mode_eligibility`
  (`types.ts:162`) means both "comfort needs a played game" and "everything matching is 100%
  complete"; the engine alone cannot name the constraint. Splitting the union into three values
  is a production **behaviour** change, out of scope for a test-writing phase (test-plan §7).
  Recorded as a known gap, following the Phase 1 precedent
  (`testing-grounding-identify-seam/plan.md:88-98`). The new copy suite asserts the mode-based
  workaround **works**, not that it is the right design.
- **Not changing any recommender behaviour.** The only production edit in this phase is a
  verbatim *move* of `emptyStateMessage()` — same inputs, same strings, same branches.
- **Not asserting the 30h edge as spec-backed.** FR-016's "medium (10–30h), long (30h+)" lets
  both buckets claim 30. The existing `30 → long` case stays green as
  documentation-of-behaviour with an in-file annotation; no new 30h assertion is authored.
- **Not testing `lengthDistance` with an empty bucket selection** — unreachable from the UI
  (see Current State Analysis).
- **Not testing `getRecommendations()`** — it is the Supabase I/O boundary; `listAllEntries`
  is already covered by `library.test.ts`.
  - **Correction (Sub-phase 4/5):** the second clause is false — `listAllEntries` has **no**
    test coverage (only its definition at `library.ts:339` and its single call site at
    `recommendation.ts:225`). Sub-phase 4's mutation run surfaced the `:224` no-coverage mutant
    as a genuine hole; see the test-plan §6.7 note. The decision to skip `getRecommendations()`
    still stands on the I/O-boundary grounds alone.
- **Not covering cross-user isolation, route contracts, e2e, or CI gates** — test-plan Phases
  3, 4 and 5 respectively.

## Implementation Approach

Five sub-phases, ordered by cost × signal with one practical override: the extraction
(Sub-phase 2) precedes the cheaper test-only work (Sub-phase 3) because it is the only
sub-phase that can break the build, so it gets maximum runway.

Sub-phase 1 is deliberately close to a **no-op** — verify-and-annotate, no new assertions. That
is the honest shape for a phase research called "largely already protected"; a sub-phase that
adds nothing is a valid outcome, not a failure.

Sub-phases 2 and 3 are TDD-able (each assertion names an observable outcome before any test
code exists) — `/10x-tdd` or `/10x-implement` both fit. Sub-phase 1 is an annotation, 4 is a
tooling pass, 5 is docs — all `/10x-implement`.

## Critical Implementation Details

**The de-prioritization assertion must be tie-break-proof, or it proves nothing.** Because
`statusPenalty` gives `completed_100` a `0` penalty in new modes (`recommendation.ts:115`), a
relaxed `isEligible` would make it score *equal* to a `played` comparator, and the outcome would
then be decided by the `created_at` → `id` tie-break. So the fixture must give the
`completed_100` entry the **tie-break-favoured** position (older `created_at`, and a
lexicographically smaller `id`): if it were merely tied on score it *would* outrank the
comparator. Asserting it does not outrank then proves de-prioritization strictly, not
tie-break luck. This is §6.6's "isolate one gate from the gate that masks it" technique applied
before Stryker rather than after.

**Stryker's `--mutate` overrides rather than accumulates** (§6.6, `test-plan.md:233`), so the two
files need two separate invocations, and `reports/mutation/index.html` must be read between runs
because it is overwritten.

---

## Sub-phase 1: Verify & annotate the existing oracle

### Overview

Establish the baseline and make the one dishonest oracle in the file honest. Adds **no
assertions** — by design.

### Changes Required

#### 1. Baseline verification

**File**: none (command only)

**Intent**: Confirm the 30 existing tests are green before anything is touched, so any later
red is attributable to this phase.

**Contract**: `npx vitest run src/lib/services/recommendation.test.ts` reports 30 passed. If the
count differs from 30, stop and reconcile before proceeding — the plan's "already protected"
premise depends on it.

#### 2. Annotate the 30h boundary case

**File**: `src/lib/services/recommendation.test.ts`

**Intent**: Mark which boundary cases carry a spec oracle and which document current behaviour,
so a future reader does not treat `30 → long` as FR-backed. Comment only — no assertion changes.

**Contract**: A comment above the `it.each` block at `:37-47` recording that `9.99`/`10` are
spec-backed (FR-016 defines short as "< 10h", so 10 belongs to medium unambiguously) while
`30`/`60` are documentation-of-behaviour — FR-016's "medium (10–30h), long (30h+)" lets both
buckets claim 30, and the `very_long` bucket has no FR at all (`prd.md:160`, `types.ts:104`).
The six assertions themselves stay byte-identical.

### Success Criteria

#### Automated Verification

- Baseline suite green at 30 tests: `npx vitest run src/lib/services/recommendation.test.ts`
- Full suite still green: `npm test`
- Lint clean: `npm run lint`

#### Manual Verification

- Reading `recommendation.test.ts:37-52` cold, it is unambiguous which boundary values have a
  spec oracle and which do not.

---

## Sub-phase 2: Empty-state copy — extract + constraint-naming suite

### Overview

The phase's only real gap and its only production-surface change. Move the human sentence into
a testable module and prove it names the binding constraint — the thing Risk #4 says the engine
`reason` alone does not prove.

### Changes Required

#### 1. Extract the copy function

**File**: `src/lib/services/recommendationCopy.ts` (new)

**Intent**: Make the reason→copy mapping reachable by the unit harness. A verbatim move: same
three branches, same three strings, same argument type. No behaviour delta.

**Contract**: Exports `emptyStateMessage(empty: Extract<RecommendationResult, { status: "empty" }>): string`
— the identical signature currently at `index.astro:54`. The three strings (including the
typographic apostrophes and quotes in the comfort sentence, `index.astro:59`) are carried over
character-for-character; a wording change here would be an unrequested behaviour change.

#### 2. Point the page at the extracted module

**File**: `src/pages/play-next/index.astro`

**Intent**: Remove the local definition and import the shared one, leaving the render path
identical.

**Contract**: Delete `:53-62`; add the import alongside the existing
`getRecommendations` import (`:7`). The call site at `:137` is unchanged.

#### 3. Constraint-naming suite

**File**: `src/lib/services/recommendationCopy.test.ts` (new)

**Behavior asserted**: For each of the three distinct exclusion causes the product can hit, the
user-facing sentence **names that cause**, and no two causes produce the same sentence.
Concretely: (i) the three cases produce pairwise-distinct sentences — if two constraints yielded
identical copy the user could not tell which one excluded everything; (ii)
`reason:"empty_library"` names the empty library; (iii) `mode_eligibility` under `comfort` names
the played-game requirement; (iv) `mode_eligibility` under **every** non-comfort mode (looped
over `NOVELTY_MODES`) names the 100%-complete constraint.

**Regression caught**: Someone collapses the copy to a single generic "No recommendations found",
or drops the `empty.mode === "comfort"` branch (`index.astro:58`) during a refactor. Today both
ship silently — the engine still returns a perfectly correct `reason` while the user is told
nothing.

**Research source**: PRD §Business Logic `prd.md:182` — the empty state "names which constraint
excluded everything, not an empty list" — the stronger of the two tiers (US-03 AC `prd.md:85`
requires only "explanatory"). Research §Detailed Findings (d) and Open Question 3.

**Edge/boundary case**: The conflated `mode_eligibility` value under comfort vs. non-comfort —
one machine reason that must yield two different sentences. That collision *is* the boundary,
and it is the exact seam the `EmptyReason` gap creates.

**Anti-pattern avoided**: Full-string equality against the implementation's literals — a
copy-paste mirror that breaks on any innocuous wording tweak while asserting nothing about
meaning. Assertions match on constraint vocabulary traceable to the PRD's own words
("empty" / "played" / "100%"), plus pairwise distinctness. Also avoided: asserting the engine's
machine `reason` as a proxy for the user having been told (Risk #4's stated must-challenge).

### Success Criteria

#### Automated Verification

- New suite green: `npx vitest run src/lib/services/recommendationCopy.test.ts`
- Full suite green: `npm test`
- Typecheck clean (catches a broken page import): `npx astro check`
- Lint clean: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification

- `/play-next` with an empty library renders the same "Your library is empty" sentence and the
  "Go to your library" link as before the extraction.
- `/play-next` in comfort mode against a library with no played games renders the same comfort
  sentence, character-for-character.
- `/play-next` in a new mode against a library where every entry is `completed_100` renders the
  100%-complete sentence.

**Implementation Note**: This is the only sub-phase that touches production source. Pause here
for manual confirmation that the rendered copy is unchanged before proceeding.

---

## Sub-phase 3: Spec-direction engine assertions

### Overview

Three assertions written against the PRD where the existing tests are written against the code.
Each is designed to survive a legitimate future implementation change and fail on a rule
violation — the inverse of the current suite's bias.

### Changes Required

#### 1. De-prioritization, asserted as direction not absence

**File**: `src/lib/services/recommendation.test.ts`

**Behavior asserted**: In a new mode, a 100%-complete game never outranks an otherwise-comparable
non-complete game.

**Regression caught**: `isEligible`'s `completed_100` guard (`recommendation.ts:92`) is relaxed or
inverted without a compensating `statusPenalty` case — at which point `completed_100` scores `0`,
identical to `played`, and wins the `created_at` tie-break into the top slot. The existing
`not.toContain("celeste")` (`:294`) also catches that, but it *only* passes under strict
exclusion; this one passes under either exclusion or genuine de-prioritization, so it keeps
protecting the rule if the divergence below is ever corrected.

**Research source**: PRD `prd.md:83` ("100%-completed games are de-prioritized except under the
'comfort' mode") and `prd.md:180`. Research Oracle Hazard #2: the spec says *de-prioritized*, the
code *excludes* — asserting absence tests the stricter code, not the rule.

**Edge/boundary case**: The score tie. Per Critical Implementation Details, the `completed_100`
entry is given the tie-break-favoured `created_at` and `id` so a mere score tie would put it
*above* the comparator; only real de-prioritization can make the assertion hold.

**Anti-pattern avoided**: `expect(order).not.toContain(...)` — blessing the code's stricter
exclusion as if it were the spec. The **exclude-vs-de-prioritize divergence** is recorded here
and in the §6.7 note rather than being asserted as correct.

#### 2. The spec-clean 10h edge, end-to-end

**File**: `src/lib/services/recommendation.test.ts`

**Behavior asserted**: With `medium` selected, a 10.0h game outranks a 9.99h one — the boundary
survives the full `bucketOf` → `lengthDistance` → `scoreOf` → sort chain, not just the classifier.

**Regression caught**: A `>=`/`>` flip at `recommendation.ts:60` or a bounds edit at
`types.ts:114-115` that pushes exactly-10h into `short`. `bucketOf(10)` is already pinned, but
nothing today proves the boundary reaches the ranked output the user reads.

**Research source**: FR-016 `prd.md:160` — short is "< 10h", so 10 belongs to medium
unambiguously. Research §Existing coverage: target (a) is covered at helper level only.

**Edge/boundary case**: Exactly the inclusive-low boundary value, paired with the largest value
strictly below it (9.99).

**Anti-pattern avoided**: Adding a 30h counterpart. FR-016 lets both buckets claim 30, so a new
30h assertion would pin an invented rule (research Oracle Hazard #1).

#### 3. Determinism across permutations, full result

**File**: `src/lib/services/recommendation.test.ts`

**Behavior asserted**: The complete `RecommendationResult` — items *and* scores — is deep-equal
across at least three distinct permutations of the same fixture, where the fixture deliberately
contains both score ties and score distinctions.

**Regression caught**: A refactor that leans on `Array.prototype.sort` stability instead of the
explicit total order (`recommendation.ts:196-207`) — stability preserves *input* order, so the
existing single reversed-input, ids-only check (`:186-190`) can pass while a third permutation
diverges. Also catches score-level nondeterminism the ids-only comparison cannot see.

**Research source**: US-03 AC `prd.md:84` and §Business Logic `prd.md:182` — "identical inputs
produce identical outputs (no randomness in v1)", so re-asking "will not capriciously reshuffle
results".

**Edge/boundary case**: The all-tied subset, the only region where ordering can wobble.

**Anti-pattern avoided**: Asserting `created_at` → `id` as the spec-mandated key. The PRD
mandates determinism, not that key (research Oracle Hazard #4); the existing `:192-201` test
stays as code-documentation and is not extended.

> **Superseded by Sub-phase 4.** The mutation pass found that test's fixture had its `created_at`
> order agreeing with its `id` order, so dropping the `created_at` branch
> (`recommendation.ts:201`) still produced the expected output — the test verified only half its
> own name. Sub-phase 4 therefore rewrote its fixture and expected value (`["a","b","c"]` →
> `["c","a","b"]`, now at `:440-464`), which kills the `:201` mutant. The test's *title* and its
> documentation-not-spec status are unchanged; only the fixture strength is.

### Success Criteria

#### Automated Verification

- Recommender suite green with 3 added tests (33 total): `npx vitest run src/lib/services/recommendation.test.ts`
- Full suite green: `npm test`
- Lint clean: `npm run lint`

#### Manual Verification

- Each new assertion is checked by hand for the mirror smell: does it restate a line of
  `recommendation.ts`, or a line of `prd.md`? It must be the latter.
- Temporarily relaxing `isEligible`'s `completed_100` guard makes assertion #1 fail (confirming
  it is not tie-break luck). Revert immediately.

---

## Sub-phase 4: Selective mutation pass

### Overview

`recommendation.ts` carries 30 assertions and has never been mutation-probed. Stryker measures
exactly what this phase is uncertain about: whether tests that *execute* the scoring lines would
actually *fail* if the weights, penalties, filter, or tie-break broke.

### Changes Required

#### 1. Two narrowed Stryker runs

**File**: none (tooling)

**Intent**: Produce a triaged survivor list per file, per §6.6's scope-narrowly rule.

**Contract**: `npx stryker run --mutate "src/lib/services/recommendation.ts"`, read
`reports/mutation/index.html`, then `npx stryker run --mutate "src/lib/services/recommendationCopy.ts"`.
Two invocations — a repeated `--mutate` overrides rather than accumulates
(`test-plan.md:233`) — and the report is overwritten between runs. Record the before score for
each file.

#### 2. Triage and targeted kills

**File**: `src/lib/services/recommendation.test.ts`, `src/lib/services/recommendationCopy.test.ts`

**Intent**: Convert business-relevant survivors into behavioural assertions; consciously ignore
the rest with a logged reason. Do not chase a score.

**Contract**: Every survivor gets the §6.6 question — *would this change hurt a user or the
business?* Yes → **one** behavioural assertion. No → ignore with a written reason. Expected
conscious-ignore classes for this module, to be confirmed against the actual report: arithmetic
mutants on `W_LEN`/`W_COMP`/`W_NOV` (`recommendation.ts:35-37`) that preserve the lexicographic
ordering the weights exist to create; `NULL_DISTANCE` values still exceeding the max real
distance of 3; the `divisor > 0` guard in `noveltyRank` (`:155`) on single-distinct-value sets;
and string-literal mutants in the copy module, which §6.6 already classes as cosmetic. No
assertion may pin a weight constant.

### Success Criteria

#### Automated Verification

- Both Stryker runs complete: `npx stryker run --mutate "src/lib/services/recommendation.ts"` and the `recommendationCopy.ts` equivalent
- Full suite green after any added assertions: `npm test`
- Lint clean: `npm run lint`

#### Manual Verification

- Every survivor is either killed or listed with a written ignore reason — no silent survivors.
- No added assertion pins a weight constant or a string literal.
- Before/after mutation scores recorded for both files, for the §6.7 note.

---

## Sub-phase 5: Cookbook §6.5 + §6.7 note + status sync

### Overview

Make the next contributor able to write a recommender test without re-deriving the oracle rules
this phase established.

### Changes Required

#### 1. Fill test-plan §6.5

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the "TBD — see §3 Phase 2" placeholder (`:220-224`) with the real recipe.

**Contract**: §6.5 covers: location/naming (co-located `src/lib/services/*.test.ts`); the
`entry({...})` fixture-factory pattern (`recommendation.test.ts:18-30`) and the date-format
hygiene rule for `Date.parse` inputs; **which oracle backs which boundary** (10h spec-backed,
30h/60h documentation-of-behaviour, and why); the de-prioritization-not-absence rule; the
assert-stability-not-tie-break-key rule; and the empty-state two-layer contract — engine emits
the machine `reason`, `recommendationCopy.ts` owns the sentence, and the copy is asserted by
constraint vocabulary plus pairwise distinctness, never full-string equality.

#### 2. Append the §6.7 Phase-2 note

**File**: `context/foundation/test-plan.md`

**Intent**: Record what the phase taught, in the Phase-1 note's shape (`:288-319`).

**Contract**: A "Phase 2 — Recommender behavior hardening (2026-07-25)" block covering: the
verify-don't-duplicate finding (30 tests already green, most of the risk pre-covered); the
one production-surface change and its justification; the **exclude-vs-de-prioritize
divergence** and the **three-bucket-spec vs four-bucket-code divergence**, both recorded not
fixed; the `EmptyReason` conflation as a known gap pointing at this plan's "What We're NOT
Doing"; and the Stryker before/after scores.

#### 3. Status sync

**File**: `context/foundation/test-plan.md`, `context/changes/testing-recommender-behavior-hardening/change.md`

**Intent**: Leave the rollout ledger accurate for the next `/10x-test-plan` resume.

**Contract**: §3 Phase 2 row Status → `complete`; the header "Last updated" line (`:9`) refreshed;
`change.md` `status: complete` and `updated: 2026-07-25`.

### Success Criteria

#### Automated Verification

- No "TBD — see §3 Phase 2" string remains in `test-plan.md`
- Markdown formatting clean: `npx prettier --check context/foundation/test-plan.md`
- Full suite still green: `npm test`

#### Manual Verification

- A contributor reading §6.5 alone can write a new recommender assertion and knows which
  boundary values have a spec oracle.
- §6.7's Phase-2 note names all recorded gaps without prescribing fixes.

---

## Testing Strategy

### Unit Tests

- `src/lib/services/recommendationCopy.test.ts` (new) — constraint-naming and distinctness across
  the three exclusion causes.
- `src/lib/services/recommendation.test.ts` (extended by 3) — de-prioritization direction, the
  10h edge end-to-end, determinism across permutations.
- Existing 30 assertions unchanged in meaning; one comment added. (Sub-phase 4 amendment: the
  tie-break test's fixture and expected value *were* changed — see the Sub-phase 3 anti-pattern
  note. Its asserted behaviour is the same rule, verified more strictly.)

### Integration Tests

None. The only I/O path (`getRecommendations` → `listAllEntries`) is covered by
`library.test.ts`, and route/ownership testing is test-plan Phase 3.

### Manual Testing Steps

1. `npm run dev`, sign in, visit `/play-next` — ranked list renders as before.
2. Switch to comfort mode against a library with no played games — confirm the comfort sentence
   is unchanged after the extraction.
3. Set every entry to 100% completed, pick a new mode — confirm the 100%-complete sentence.
4. Re-submit the same dial selection three times — the order does not change.

## Performance Considerations

None. All added tests are pure and in-memory; the extraction moves one function between modules
with no runtime cost.

## Migration Notes

Not applicable — no data model, schema, or API change. The single production edit is a
same-behaviour code move; rollback is reverting one import.

## References

- Research: `context/changes/testing-recommender-behavior-hardening/research.md`
- Change identity: `context/changes/testing-recommender-behavior-hardening/change.md`
- Test plan: `context/foundation/test-plan.md` (Risk #4 response `:76`; §6.5 `:220`; §6.6 `:226`; §6.7 `:283`; §7 `:321`)
- Oracle: `context/foundation/prd.md:80,83,84,85` (US-03 AC), `:160` (FR-016), `:180,182` (Business Logic)
- Phase 1 precedent: `context/changes/testing-grounding-identify-seam/plan.md:88-106`
- Code under test: `src/lib/services/recommendation.ts`, `src/pages/play-next/index.astro:53-62`
- Extraction precedent: `src/components/library/playStatus.ts` ← `src/pages/play-next/index.astro:9`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Verify & annotate the existing oracle

#### Automated

- [x] 1.1 Baseline suite green at 30 tests — 17f9a87
- [x] 1.2 Full suite green (`npm test`) — 17f9a87
- [x] 1.3 Lint clean — 17f9a87

#### Manual

- [x] 1.4 Spec-backed vs documentation-of-behaviour boundaries are unambiguous in-file — 17f9a87

### Phase 2: Empty-state copy — extract + constraint-naming suite

#### Automated

- [x] 2.1 New copy suite green — e617b96
- [x] 2.2 Full suite green (`npm test`) — e617b96
- [x] 2.3 Typecheck clean (`npx astro check`) — e617b96
- [x] 2.4 Lint clean — e617b96
- [x] 2.5 Build succeeds (`npm run build`) — e617b96

#### Manual

- [x] 2.6 Empty-library copy + link render unchanged — e617b96
- [x] 2.7 Comfort-mode copy renders character-for-character unchanged — e617b96
- [x] 2.8 All-100%-complete copy renders unchanged — e617b96

### Phase 3: Spec-direction engine assertions

#### Automated

- [x] 3.1 Recommender suite green at 33 tests — 26c9307
- [x] 3.2 Full suite green (`npm test`) — 26c9307
- [x] 3.3 Lint clean — 26c9307

#### Manual

- [x] 3.4 Each new assertion traced to a PRD line, not a source line — 26c9307
- [x] 3.5 Relaxing the `completed_100` guard makes the de-prioritization assertion fail (then reverted) — 26c9307

### Phase 4: Selective mutation pass

#### Automated

- [x] 4.1 Stryker run on `recommendation.ts` completes — 6315c2c
- [x] 4.2 Stryker run on `recommendationCopy.ts` completes — 6315c2c
- [x] 4.3 Full suite green after added assertions — 6315c2c
- [x] 4.4 Lint clean — 6315c2c

#### Manual

- [x] 4.5 Every survivor killed or logged with an ignore reason — 6315c2c
- [x] 4.6 No assertion pins a weight constant or string literal — 6315c2c
- [x] 4.7 Before/after mutation scores recorded — 6315c2c

### Phase 5: Cookbook §6.5 + §6.7 note + status sync

#### Automated

- [x] 5.1 No "TBD — see §3 Phase 2" remains in `test-plan.md` — bc8340a
- [x] 5.2 Prettier check clean on `test-plan.md` — bc8340a
- [x] 5.3 Full suite still green — bc8340a

#### Manual

- [x] 5.4 §6.5 is self-sufficient for a new contributor — bc8340a
- [x] 5.5 §6.7 note records all gaps without prescribing fixes — bc8340a
