---
date: 2026-07-25T16:48:50+02:00
researcher: Tomasz Marcinkowski
git_commit: b1d2c59fa1de4e3e8bf78379e693ed3220423e0a
branch: main
repository: GamingLibrary
topic: "Recommender behavior hardening — where the ranking logic lives, what the FR/US oracle says, and what tests already cover vs. Risk #4's four targets"
tags: [research, codebase, recommender, recommendation, scoring, test-plan, risk-4, unit-tests]
status: complete
last_updated: 2026-07-25
last_updated_by: Tomasz Marcinkowski
---

# Research: Recommender behavior hardening (test-plan Phase 2, Risk #4)

**Date**: 2026-07-25T16:48:50+02:00
**Researcher**: Tomasz Marcinkowski
**Git Commit**: b1d2c59fa1de4e3e8bf78379e693ed3220423e0a
**Branch**: main
**Repository**: GamingLibrary

## Research Question

Ground Phase 2 of `context/foundation/test-plan.md` ("Recommender behavior hardening", Risk #4). Where does the recommender ranking logic actually live, how does it treat the four failure targets — (a) length-bucket edges at exactly 10h / 30h, (b) 100%-complete de-prioritization outside comfort mode, (c) deterministic ordering / tie-break, (d) an explained empty-state — and what do the FR/business rules (FR-015/016/018, US-03) say, so the test oracle comes from the spec and not from the code under test?

## Summary

**The headline finding is that this phase is largely already done.** The existing unit suite `src/lib/services/recommendation.test.ts` (26 cases) already covers targets (a), (b), (c), and the *engine-level* half of (d) with behavioural assertions that are not code-mirrors. The recommender is a clean, fully pure function (`recommend()` in `recommendation.ts`) — no I/O, no clock, no RNG in the scoring path — so it is trivially unit-testable, and the team has already exploited that.

The phase therefore should **not** re-assert what's covered. Its real, defensible surface is narrow:

1. **One genuine coverage gap (target d, user-facing half):** the human sentence that "names which constraint excluded everything" lives in `emptyStateMessage()` inside `src/pages/play-next/index.astro:54-62` — an **unexported Astro-frontmatter function with zero tests**. The engine returns a structured `{status:"empty", reason, mode}`, but `EmptyReason` has only two values (`empty_library | mode_eligibility`), so `mode_eligibility` **conflates two distinct constraints** (comfort-needs-a-played-game vs. everything-matching-is-100%-complete) — they are disambiguated only by the `mode` field, and only in the page's copy.

2. **One oracle hazard the test author must respect:** the spec's 30h boundary is **textually ambiguous** — FR-016 writes "medium (10–30h), long (30h+)", so both buckets claim 30. The existing test asserts `bucketOf(30)==="long"`, which is the *code's* choice, not a spec-mandated one. Per the risk-response ("Assertion copied from the scoring code it tests instead of from the FR/business rule"), any exact-30h assertion is asserting an **invented rule**. 10h is cleaner (short is `< 10`, so 10 belongs to medium unambiguously).

Net recommendation for the plan phase: treat (a)/(b)/(c) as **already protected — verify, don't duplicate**; scope the actual new work to the untested empty-state *message* logic and, optionally, a `recommend()`-level (not just `bucketOf`-level) boundary assertion — while consciously flagging the 30h ambiguity rather than hard-coding the code's answer. Consider whether the two-constraint conflation in `EmptyReason` is a code gap to record (test-writing phase changes no production behaviour — see test-plan §7).

## Detailed Findings

### The recommender module (all pure, all testable)

Primary module: `src/lib/services/recommendation.ts` (228 lines, pure — doc comment `recommendation.ts:16-18`). Types in `src/types.ts`. All scoring helpers are exported specifically for unit testing (`recommendation.ts:47`, "Pure helpers (exported for unit tests)").

**Two entry points:**
- Pure engine — `recommend(entries, request, limit=10): RecommendationResult` at `recommendation.ts:180`. This is the test target.
- Impure wrapper — `getRecommendations(supabase, request, limit=10)` at `recommendation.ts:220` → calls `listAllEntries(supabase)` (`library.ts:339`) then delegates to `recommend()` (`recommendation.ts:225-226`). The only I/O boundary; keep it out of unit tests.

**Score formula** — `scoreOf()` at `recommendation.ts:166-170`:
```ts
return -(W_LEN * distance) - W_COMP * status + W_NOV * novelty;
```
Weights `W_LEN=1000`, `W_COMP=100`, `W_NOV=1` (`recommendation.ts:35-37`) are engineered so ordering is effectively lexicographic: length distance ≫ status penalty ≫ novelty (doc `recommendation.ts:28-34`). Higher score = better.

Public/independently-testable helpers: `bucketOf`, `lengthDistance`, `isEligible`, `statusPenalty`, `noveltyRank`, `scoreOf`. (`noveltyGoodness` at `:125` is module-private.)

### (a) Length buckets — exact 10h / 30h behaviour

Bounds table `types.ts:113-118`:
```ts
short:     { minH: 0,  maxH: 10 },
medium:    { minH: 10, maxH: 30 },
long:      { minH: 30, maxH: 60 },
very_long: { minH: 60, maxH: null },
```
Classifier `bucketOf()` boundary conditional at `recommendation.ts:60`:
```ts
if (lengthHours >= minH && (maxH === null || lengthHours < maxH)) {
```
Inclusive-low / exclusive-high (`>= minH`, `< maxH`). So **10h → medium** (fails `10 < 10`, matches `10>=10 && 10<30`); **30h → long** (fails `30 < 30`, matches `30>=30 && 30<60`). `null` length → `null` bucket (`:55-57`); negatives clamp to `short` (`:64-65`).

Distance `lengthDistance()` at `recommendation.ts:73-80`: null/empty selection → `NULL_DISTANCE=4` (`:45`); else min absolute index-distance to a selected bucket. **Length is a graded soft penalty and never excludes** a game (doc `recommendation.ts:82-86`, `types.ts:159-161`).

### (b) 100%-complete + comfort mode

Completion == the `play_status` enum value `"completed_100"` — there is **no numeric progress field** in the scoring path. `PlayStatus` order: `not_played, playing_now, played, completed, completed_100` (`types.ts:25`). Note `completed` ≠ `completed_100`.

Hard filter `isEligible()` at `recommendation.ts:88-93`:
```ts
if (mode === "comfort") return entry.play_status !== "not_played";
return entry.play_status !== "completed_100";
```
- Non-comfort (`new_releases`, `newly_bought`): `completed_100` **excluded entirely** (filtered at `recommendation.ts:185`). `completed` survives but is penalised.
- Comfort: excludes `not_played` instead; `completed_100` **included but max-penalised** (penalty `1`, worst — `statusPenalty` `recommendation.ts:102-116`).

"Comfort mode" is enabled by `request.mode === "comfort"` (`types.ts:148`) — no separate boolean. It flips three things: the hard filter, the status-penalty scale (binary → 4-step graded), and the novelty axis (favours older releases — `noveltyGoodness` `:135`).

### (c) Ordering / tie-break — fully deterministic

Sort at `recommendation.ts:196-207`: primary = descending score; tie-break 1 = `created_at` ascending (oldest first); tie-break 2 = `id` ascending (guaranteed-unique). **Does not rely on sort stability or input order.** Then `.slice(0, limit)` (`:209`). No `Math.random`/`Date.now`; inputs never mutated in place.

### (d) Empty-state — structured reason (engine) + human copy (page)

Engine returns a discriminated union (`types.ts:168-170`), never a bare array. `recommend()` at `recommendation.ts:181-188`:
```ts
if (entries.length === 0) return { status:"empty", reason:"empty_library", mode };
const eligible = entries.filter(e => isEligible(e, mode));
if (eligible.length === 0) return { status:"empty", reason:"mode_eligibility", mode };
```
`EmptyReason = "empty_library" | "mode_eligibility"` (`types.ts:162`). **Length is never an empty-state cause** (it's graded, so an eligible non-empty set always yields at least one ranked item — doc `types.ts:159-161`).

The **sentence that names the excluding constraint** is at the page layer, `src/pages/play-next/index.astro:54-62`:
```ts
if (empty.reason === "empty_library") return "Your library is empty — add a game first.";
if (empty.mode === "comfort") return "Comfort mode needs games you've played — you have none yet. …";
return "Every game matching is already 100% completed — try comfort mode.";
```
So the single `mode_eligibility` reason splits into two user-facing constraints purely via `mode`. **This function has no test.**

### Existing test coverage vs. the four targets

`src/lib/services/recommendation.test.ts` — 26 cases, Vitest `^4.1.10` (`package.json:69`), `environment:"node"`, co-located, uses a local `entry({...})` fixture factory + `req()`/`ids()` helpers (`recommendation.test.ts:18-33`). No mocks (pure function).

| Target | Verdict | Evidence |
|--------|---------|----------|
| (a) exactly 10h / 30h | **COVERED** (helper level) | `it.each` at `recommendation.test.ts:37-47` asserts `bucketOf(10)==="medium"`, `bucketOf(30)==="long"` (+9.99/29.99/59.99/60). Gap: no `recommend()`-level test proves a 10h game *ranks* as medium end-to-end. |
| (b) 100%-complete de-prioritized outside comfort | **COVERED** | `isEligible` test `:78-82` (excluded in both non-comfort modes, `completed` kept); end-to-end spot-check `:293-294` confirms a `completed_100` entry absent from `newly_bought` output. |
| (c) deterministic ordering / tie-break | **COVERED** | `:186-190` order-invariance (reversed input → identical output); `:192-201` composite tie-break `created_at` asc → `id` asc. |
| (d) explained empty-state | **COVERED (engine) / MISSING (user copy)** | All three engine branches asserted `:205-226`. But `emptyStateMessage()` (`index.astro:54-62`) is untested, and `mode_eligibility` conflates two constraints (disambiguated only by `mode`). |

### The FR/US oracle (independent of the code)

Authoritative source `context/foundation/prd.md`; roadmap/shape-notes restate the same rule (PRD canonical).

- **FR-015** (`prd.md:158`): user can request a "what should I play next?" ranked list — "the recommender IS the core value proposition."
- **FR-016** (`prd.md:160`): length buckets "short (< 10h), medium (10–30h), long (30h+)". **Only place hours are defined.**
- **FR-018** (`prd.md:164`): three modes — "new releases" (release-date recency), "newly bought" (date-added recency), "comfort" (older, previously-played/completed).
- **US-03** (`prd.md:73-85`), acceptance criteria include:
  - `:83` "100%-completed games are de-prioritized except under the 'comfort' mode"
  - `:84` "Ranking is deterministic — identical inputs produce identical outputs (no randomness in v1)"
  - `:85` "If the library has no eligible game … the user sees an explanatory empty-state, not an empty list"
- **Business Logic** (`prd.md:180,182`) — stronger than US-03 on two points: 100%-complete games are "de-prioritized except under 'comfort', where previously-played titles are exactly what's wanted"; and the empty state "**names which constraint excluded everything**, not an empty list."

## Code References

- `src/lib/services/recommendation.ts:180` — `recommend()` pure entry point (test target)
- `src/lib/services/recommendation.ts:60` — bucket boundary conditional (`>= minH && < maxH`)
- `src/lib/services/recommendation.ts:88-93` — `isEligible()` (comfort vs. non-comfort exclusion)
- `src/lib/services/recommendation.ts:102-116` — `statusPenalty()` (binary vs. 4-step comfort scale)
- `src/lib/services/recommendation.ts:166-170` — `scoreOf()` weighted formula
- `src/lib/services/recommendation.ts:181-188` — empty-state branches + `EmptyReason`
- `src/lib/services/recommendation.ts:196-207` — deterministic sort + tie-break
- `src/lib/services/recommendation.ts:220-227` — `getRecommendations()` impure wrapper (I/O boundary)
- `src/types.ts:113-118` — `LENGTH_BUCKET_BOUNDS` (the boundary oracle)
- `src/types.ts:146-170` — `RecommendationRequest`, `RecommendationItem`, `EmptyReason`, `RecommendationResult`
- `src/pages/play-next/index.astro:31` — sole production call site
- `src/pages/play-next/index.astro:54-62` — `emptyStateMessage()` (untested user-facing constraint naming)
- `src/lib/services/recommendation.test.ts:37-47,78-82,186-201,205-226` — existing coverage of (a)/(b)/(c)/(d-engine)
- `context/foundation/prd.md:158-165,73-85,178-184` — FR-015/016/018, US-03, Business Logic (the oracle)

## Architecture Insights

- **The recommender was designed for exactly this test phase.** The pure/impure split (`recommend` vs. `getRecommendations`), the exported helpers, the structured `EmptyReason` union, and the explicit three-key deterministic sort all read as pre-hardened. The score-weight engineering (1000/100/1) makes ranking *lexicographic-by-construction*, so most "tie" behaviour is already deterministic before the sort's tie-break keys even engage.
- **The empty-state contract is split across two layers by design**: the engine emits a machine `reason` + `mode`; the page owns the human sentence. That boundary is why (d) is "COVERED (engine) / MISSING (copy)" — and why the `mode_eligibility`-conflates-two-constraints observation is a *page-copy* concern, not an engine bug.
- **Determinism caveat for fixtures**: `noveltyGoodness` uses `Date.parse` on *input* fields (`release_date`, `date_bought`, `created_at`) — deterministic, but `Date.parse` of a datetime string without offset is runtime/TZ-dependent. Keep fixtures in date-only or ISO-with-offset form (the existing factory uses `"2026-01-01T00:00:00Z"`).

## Oracle Hazards (must not invent rules)

Grounded in the risk-response anti-pattern ("Assertion copied from the scoring code it tests instead of from the FR/business rule"):

1. **30h is spec-ambiguous.** FR-016 "medium (10–30h), long (30h+)" — both claim 30. The code says `30 → long`; that is a code choice, not spec. An exact-30h assertion pins an invented rule. **10h is clean** (short is `< 10`). If the phase asserts a 30h case, it should cite the code as documentation-of-current-behaviour, not the FR as oracle — or flag the ambiguity as a spec gap.
2. **"De-prioritized" ≠ "excluded."** `prd.md:83,180` say 100%-complete games are *de-prioritized* outside comfort; the spec deliberately does not say *removed*. The code actually *excludes* them (`isEligible` filter) — stronger than the spec. A test asserting *absence* is testing the code's stricter behaviour, not the spec; assert de-prioritization direction from the spec, and record the exclude-vs-deprioritize divergence rather than blessing it.
3. **"Older" / "recent" have no numeric threshold** anywhere in the PRD. Only *relative/directional* novelty assertions are spec-backed (older comfort-eligible game not ranked below a brand-new unplayed one), never absolute cutoffs.
4. **Tie-break order is unspecified by the PRD.** Determinism is required (`:84`), but the specific `created_at → id` key is a code choice. Assert *stability* (same input → same output) from the spec; treat the exact secondary order as code-documentation.
5. **Empty-state "names the constraint" is two-tier.** US-03 AC (`:85`) only requires "explanatory." The stronger "names which constraint excluded everything" is in Business Logic (`:182`) / roadmap S-07 — defensible to cite, but note the AC alone is weaker.

## Historical Context (from prior changes)

- `context/changes/testing-grounding-identify-seam/` — Phase 1 (complete, mutation-hardened). Established the project's test conventions this phase inherits: co-located `*.test.ts`, oracle-not-mirror discipline, "a test-writing phase changes no production behaviour — record code gaps, don't fix them" (test-plan §7 and §6.7 Phase-1 notes). The Phase-1 pattern of *recording two known code gaps without fixing them* is the direct precedent for how to handle the `EmptyReason` conflation and the exclude-vs-deprioritize divergence here.
- `context/foundation/test-plan.md:76` (Risk #4 response row) — the exact four targets and the anti-pattern ("Assertion copied from the scoring code it tests"). §6.1 names `recommendation.test.ts` as the reference unit test; §6.5 reserves the recommender cookbook slot for this phase to fill.
- `context/foundation/lessons.md` — two entries, both IGDB/Cloudflare-specific; neither touches the recommender. No prior recurring rule constrains this phase.

## Related Research

- None prior for the recommender specifically. This is the first `/10x-research` on `context/changes/testing-recommender-behavior-hardening/`. Phase-1 sibling research: `context/changes/testing-grounding-identify-seam/research.md`.

## Open Questions

1. **Is the `mode_eligibility` two-constraint conflation a code gap to record?** The engine can't distinguish "comfort needs a played game" from "everything matching is 100%-complete" without `mode`. Splitting `EmptyReason` into three values would be a production change — out of scope for a test phase, but a candidate to log in the plan's "What We're NOT Doing" (mirroring Phase 1).
2. **Does the plan want a `recommend()`-level boundary test** (a 10h game ranks in the medium bucket end-to-end) to close the "helper-level only" caveat on target (a), or is the `bucketOf` + `lengthDistance` chain coverage sufficient under cost × signal?
3. **Should `emptyStateMessage()` be made testable?** It's unexported Astro frontmatter. Testing it means either exporting it (small production-surface change) or an e2e/page-render assertion (wrong layer for a unit phase). The cheapest real signal may be to extract the reason→copy mapping into a pure exported helper — a production change to weigh against test-plan §7.
4. **How to treat the 30h boundary assertion** — keep the existing `30 → long` test as documentation-of-behaviour, add a comment citing the FR-016 ambiguity, or raise the ambiguity as a spec-refinement question before writing more boundary cases?
