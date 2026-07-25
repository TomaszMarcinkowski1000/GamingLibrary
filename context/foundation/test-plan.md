# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-07-25 (Phase 2 complete + mutation-hardened: testing-recommender-behavior-hardening)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic check that already catches the
   regression. The killer feature (photo → identify → enrich) is defended at
   the integration layer first; the browser journey earns an e2e only
   because no cheaper layer covers camera capture.
2. **User concerns are first-class evidence.** Risks anchored in "the
   builder is worried about X, and the failure would surface somewhere in
   `<area>`" carry the same weight as PRD lines or hot-spot data. The whole
   risk map's top two rows come from the Phase 2 interview.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/` (services, components,
pages, api, lib) — excluding `src/components/ui/` (vendored), build output,
`context/`, and fixtures. History was thin (5 commits/30d, recent work was
H-01…H-05 polish), so likelihood leans on the roadmap, archive, and the
Phase 2 interview more than on churn.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|-------------------------|--------|------------|---------------------------------|
| 1 | Photo path attaches the wrong game / edition / platform or wrong metadata — grounding regresses to an edition variant, or a thin/ambiguous read false-positives instead of abstaining — and the auto-saved entry is silently trusted. | High | High | interview Q1, Q2; archive `enrichment-match-precision/plan.md` (S-09); PRD §Success Criteria > Guardrails (≥90%) |
| 2 | The photo identify orchestration mis-assembles — an un-normalized platform/title reaches grounding, or a `no_match`/abstain still auto-saves a guess instead of offering manual entry (FR-006). | High | High | interview Q1, Q3; archive `photo-to-library/plan.md`; roadmap H-03; hot-spot dir `src/lib/services` (5 commits/30d) |
| 3 | The end-to-end photo journey breaks on a mobile browser — camera capture → identify → auto-saved entry never lands visibly, or a desktop step sneaks in. | High | Medium | interview Q4; PRD §NFR (mobile-camera path, latest-two of 4 browsers); US-01 |
| 4 | The recommender ranks wrong — length bucket ignored, a 100%-completed game surfaces outside comfort mode, ordering is non-deterministic, or an empty list appears instead of an explained empty-state. | High | Medium | PRD §Business Logic (the reason-to-exist); FR-015, FR-016, FR-018; US-03 |
| 5 | Cross-user library exposure (IDOR / RLS gap) — a request authenticated as user A reads, mutates, or deletes user B's entry; or search / filter / recommend returns another user's rows. | High | Low–Med | PRD §NFR (per-user isolation); PRD §Access Control (open sign-up = real multi-user); abuse/security lens |
| 6 | Input-boundary regressions in the add/edit path — a decimal length is rejected, a platform alias is stored un-normalized, or client/server validation parity drifts. | Medium | Medium | archive H-01/H-02/H-03 (v1 hardening); hot-spot dir `src/components/library` (10 commits/30d) |

**Impact × Likelihood rubric.** High = user loses access/data/money or the
failure is publicly visible / area changes weekly or we were already burned
here. Medium = feature degrades with a workaround / touched occasionally,
past source of bugs. Low = cosmetic / stable, rarely touched.

**Abuse-lens note.** Risk #5 was not raised by the interview (the builder
named photo integrity as the top worry). It is included because open sign-up
plus a hard isolation NFR make cross-user access a real surface the
happy-path interview cannot surface. Silent data-loss (High × Low on managed
Supabase) belongs to observability, not a test, and is deliberately excluded
(see §7). Secret/PII leakage is folded into Risk #2's "must challenge" (the
identify error path must not echo provider keys or raw upstream errors).

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | A read that resolves to an edition variant collapses to the base-game id; a thin/ambiguous read yields `no_match`, not wrong metadata attached. | "Grounding returned a result" is not "grounding returned the *right* result." | The edition-collapse rule and the false-positive threshold; the S-09 shelf sample as an independent truth-set/oracle. | integration (grounding logic vs. fixtures) | Oracle problem: asserting whatever IGDB currently returns instead of the base-game truth from the S-09 sample. |
| #2 | An abstain / `no_match` routes to manual entry and does **not** auto-save; normalization runs before grounding; the error path surfaces a clean failure without leaking provider keys/raw upstream errors. | "identify succeeded because a row was saved." | The read → normalize → ground → save decision points; what each failure branch routes to; the auth/session shape a route test needs. | integration (identify seam, external providers mocked at the network edge) | Happy-path-only; over-mocking the internal grounding step so the seam under test is hollow. |
| #3 | On a real mobile browser, capture → identify → auto-save → entry-visible completes with no required desktop step. | "works on desktop Chrome" is not "works on mobile Safari camera." | The browser capture entry point; the visible-in-library assertion; what the abstain path shows the user. | e2e (Playwright) — no cheaper layer covers the browser + camera journey. | e2e-ing what an integration test already covers (grounding/seam logic). |
| #4 | The spec-clean bucket edge (exactly 10h → medium) holds; 100%-complete games are de-prioritized outside comfort; ordering is stable for identical inputs; and the empty state *names the constraint that excluded everything* — in the copy the user actually reads, not only in the engine's machine `reason`. | "the happy-path top rank is correct" is not "boundaries and de-prioritization are correct." Also: "the engine returned `mode_eligibility`" is not "the user was told which constraint excluded everything." | The scoring inputs; the tie-break/determinism rule; the empty-state contract, including **which layer owns the human sentence** naming the constraint. | unit (pure scoring function, no I/O) | Assertion copied from the scoring code it tests instead of from the FR/business rule. Three known oracle hazards (research 2026-07-25): (i) **30h is spec-ambiguous** — FR-016 "medium (10–30h), long (30h+)" lets both buckets claim 30, so an exact-30h assertion pins an invented rule; assert 10h, and treat any 30h case as documentation-of-behaviour, not spec; (ii) the spec says 100%-complete games are *de-prioritized*, the code *excludes* them — asserting absence tests the stricter code, not the rule; (iii) the PRD mandates determinism but not the specific `created_at → id` tie-break key — assert same-input-same-output, not the secondary order. |
| #5 | A request authenticated as user A is rejected (or returns empty) for user B's resource id across GET / PUT / DELETE. | "an RLS policy exists" is not "the route enforces ownership." | Where ownership is actually enforced (RLS vs. handler); how to author a two-user route test with real sessions. | integration (route contract, two distinct users) | Testing only the logged-in happy path; trusting RLS without exercising a cross-user request. |
| #6 | A decimal length saves; platform aliases normalize; the server rejects what the client rejects. | "client-side validation is enough." | The zod parity between client and server; the platform normalization map. | unit + integration | Mirroring the implementation's own validation constants instead of the FR/spec. |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|----------------|-----------|--------|----------------|
| 1 | Grounding & identify-seam integration | Prove the photo path cannot silently save the wrong game/metadata | #1, #2 | integration + unit | complete | context/changes/testing-grounding-identify-seam/ |
| 2 | Recommender behavior hardening | Lock the reason-to-exist against boundary and negative-space gaps | #4 | unit | complete | context/changes/testing-recommender-behavior-hardening/ |
| 3 | API route contracts + cross-user isolation | Prove routes enforce ownership and validation parity, not just auth | #5, #6 | integration | not started | — |
| 4 | End-to-end photo flow | Exercise the mobile capture → identify → visible journey once | #3 | e2e | not started | — |
| 5 | Quality-gates wiring | Lock the floor in CI (test + e2e gates) | cross-cutting | gates | not started | — |

**Status vocabulary** (fixed — parser literals): `not started` →
`change opened` → `researched` → `planned` → `implementing` → `complete`.

Order rationale: Phase 1 attacks the convergent worst-break (interview Q1–Q3,
High × High) at the cheapest layer that gives real signal. Phase 2 is a cheap,
high-signal pure-function pass extending the existing recommender unit tests.
Phase 3 needs a route/Supabase harness, so it follows the seam work that
first stands one up. Phase 4 is the most expensive layer and is promoted to
e2e only because no cheaper layer covers camera capture. Phase 5 wires the
gates once tests exist to enforce.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | Vitest | 3.x (`vitest.config.ts`) | Configured; 6 tests, all in `src/lib/*` (igdb, library, recommendation, validation, platforms, image). `npm test` = `vitest run`. |
| API / provider mocking | MSW or `vi.mock` at the network edge | — | none yet — see §3 Phase 1. Mock IGDB/vision HTTP at the edge; never mock internal grounding. |
| Route/Worker integration | Astro/Cloudflare Worker test harness | — | none yet — see §3 Phase 3. Astro SSR on Cloudflare Workers; route tests need a Worker/Miniflare-style harness or a Supabase test client. |
| e2e | Playwright | — | none yet — see §3 Phase 4. Must cover mobile-browser camera capture. |
| accessibility | axe-core | — | optional; not currently scoped. |
| (optional) AI-native | — | — | Not justified under cost × signal for v1; grounding/vision correctness is defended by deterministic integration tests against the S-09 fixture, not a model-on-model check. |

**Stack grounding tools (current session):**
- Docs: Context7 — available; use for current Vitest / Astro test-utils / Supabase SSR test-setup APIs when Phases 1 and 3 wire harnesses; checked: 2026-07-18
- Search: Exa.ai — available; use to confirm current Playwright-on-Cloudflare and Astro Worker test-harness options before Phase 4; checked: 2026-07-18
- Runtime/browser: no Playwright/browser MCP exposed in this session — Phase 4 wires Playwright as a project dependency, not via MCP; checked: 2026-07-18
- Provider/platform: Supabase MCP — available (read-only); could verify RLS policies and schema during Phase 3 research; checked: 2026-07-18

Use docs MCPs for current framework/library APIs and setup details. Use
search MCPs for discovery or current status only, then prefer official docs
as evidence. Do not use MCP docs/search to infer code failure anchors; those
belong in per-phase `/10x-research`.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint + typecheck | local + CI | required (wired today: `eslint`, `astro check`) | syntactic / type drift |
| unit + integration | local + CI | required after §3 Phase 1 | logic regressions in grounding, identify seam, recommender, routes |
| e2e on critical flows | CI on PR | required after §3 Phase 4 | broken mobile photo journey |
| post-edit hook | local (agent loop) | recommended (optional) | regressions at edit time on the service layer |
| pre-prod smoke | between merge + prod | optional | Worker/edge-specific failures the local suite misses |

CI today (`.github/workflows/ci.yml`) runs lint + build only; §3 Phase 5
wires `npm test` (required after Phase 1) and the e2e gate (after Phase 4).

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, it reads "TBD — see §3 Phase N."

### 6.1 Adding a unit test

- **Location**: next to the unit under test, `src/lib/<area>/<module>.test.ts`.
- **Naming**: `<module>.test.ts` (co-located, matching the existing 6 tests).
- **Reference test**: `src/lib/services/recommendation.test.ts` (existing).
- **Run locally**: `npm test` (or `npm run test:watch`).

### 6.2 Adding an integration test (grounding / identify seam)

Hermetic integration: mock the two providers at the `globalThis.fetch` edge,
stub Supabase, and **never** mock the internal grounding or the vision
normalizers — those are the seam under test.

- **Location / naming**:
  - Grounding wiring (`lookupGameMetadata` end-to-end):
    `src/lib/services/igdb.integration.test.ts` (co-located; `.integration.`
    infix distinguishes it from the pure-unit `igdb.test.ts` next to it).
  - Route seam (`/api/identify` contract): `src/pages/api/identify.test.ts`
    (co-located with the route).
- **The mock edge is `globalThis.fetch`.** `igdb.ts` never calls `fetch`
  directly — the wrapper's token-caching fetch forwards everything except the
  cached Twitch token to `globalThis.fetch`, so intercepting it exercises the
  **real** wrapper query serialization. Use the shared router
  `test/helpers/fetch-mock.ts` → `installFetchRouter(routes)`: routes are keyed
  by URL substring (`id.twitch.tv/oauth2/token`, `/v4/games`,
  `/v4/game_time_to_beats`, `openrouter.ai`), the Twitch token endpoint is
  answered by default (every IGDB call mints on a cache miss), and any unrouted
  URL throws a loud "unexpected fetch" instead of hitting the network. Call
  `router.restore()` in `afterEach`; read `router.requests` to assert the
  **outgoing** request (e.g. the `/v4/games` body carries the normalized title).
- **Env stub**: `test/stubs/astro-env-server.ts` (aliased in
  `vitest.config.ts`) supplies non-empty *dummy* `TWITCH_CLIENT_ID/SECRET` and
  `OPENROUTER_API_KEY` so `createIgdbClient` / `identifyGameFromPhoto` run their
  real paths instead of throwing on a missing secret. `SUPABASE_*` stay
  `undefined` on purpose.
- **Supabase stub**: mock `@/lib/supabase`'s `createClient` to return the
  capturing `insertClient()` shape (`.insert().select().single()` capturing the
  payload — mirrors `library.test.ts`). The persist path then needs no
  `SUPABASE_*` env, and assertions read the exact payload that would be written.
  Under vitest also `vi.mock("cloudflare:workers", () => ({ env: { IGDB_TOKENS:
  {} } }))` — a `{}`-shaped KV forces the token cache to miss so the router
  answers the mint.
- **Reference tests**: `src/lib/services/igdb.integration.test.ts` (grounding),
  `src/pages/api/identify.test.ts` (route seam).
- **Two hard rules**:
  1. Never mock the internal grounding (`lookupGameMetadata` /
     `collapseToBaseGame` / `isConfidentMatch`) — over-mocking hollows out the
     seam under test.
  2. Never mock the `vision.ts` module — its normalizers are load-bearing for
     the saved value; mocking it skips them and makes a normalize-before-ground
     assertion hollow.
- **Oracle, not mirror**: the edition-collapse / `no_match` truth comes from
  authored `Game`-shaped fixtures encoding base-game truth (the S-09 shelf
  fixture is gitignored, so it is *authored*, never read from disk). Never copy
  a value produced by `igdb.ts` into an assertion.
- **Run locally**: `npm test`.

### 6.3 Adding an e2e test

- TBD — see §3 Phase 4. Will cover: mobile-browser camera capture →
  identify → auto-saved → visible in library.

### 6.4 Adding a test for a new API endpoint

- TBD — see §3 Phase 3. Will cover: route contract (request → response shape
  AND side-effects), ownership enforcement with two distinct users, and
  client/server zod validation parity. Mock the external HTTP edge only.

### 6.5 Adding a test for the recommender / scoring rules

The engine is pure — `recommend(entries, request, limit)` takes plain data and
returns a discriminated `RecommendationResult`; no Supabase, no clock, no RNG.
So every recommender test is a plain unit test, and the whole difficulty is the
**oracle**, not the harness. Read this section before adding one: three of the
four boundaries a test naturally reaches for have no spec behind them.

- **Location / naming**: co-located, `src/lib/services/<module>.test.ts` —
  `recommendation.test.ts` (engine + scoring helpers) and
  `recommendationCopy.test.ts` (the user-facing empty-state sentence).
- **Run locally**: `npm test`, or
  `npx vitest run src/lib/services/recommendation.test.ts`.
- **The surface under test** (`src/types.ts:146-170`), so a first draft compiles:

  ```ts
  recommend(entries: LibraryEntry[], request: RecommendationRequest, limit = 10): RecommendationResult
  // RecommendationRequest = { lengthBuckets: LengthBucket[]; mode: NoveltyMode }
  // NOVELTY_MODES  = ["new_releases", "newly_bought", "comfort"]   // "comfort" is the odd one out
  // LENGTH_BUCKETS = ["short", "medium", "long", "very_long"]      // four — see the oracle table
  // RecommendationResult =
  //   | { status: "ranked"; items: { entry: LibraryEntry; score: number }[] }   // score: higher = better
  //   | { status: "empty";  reason: EmptyReason; mode: NoveltyMode }
  // EmptyReason = "empty_library" | "mode_eligibility"
  ```

  `status` is the discriminant, so narrow on it before touching `items` — the
  `ids()` / `rankOf()` helpers in `recommendation.test.ts:81-96` already do,
  and rule 2 below needs `items[].score`, not just the ids.
- **Fixtures**: use the `entry({ id, … })` factory
  (`recommendation.test.ts:18-30`). It fills the narrow column set the
  recommender reads and casts the rest away, mirroring `listAllEntries`'s
  partial select — so a test never has to author a full `LibraryEntry`.
  - **Date hygiene.** `noveltyGoodness` calls `Date.parse` on `release_date` /
    `date_bought` / `created_at` (`recommendation.ts:128,131`). A datetime
    string **without** an offset parses TZ-dependently, which is a latent flake.
    Keep new fixtures date-only (`"2021-01-01"`) or ISO-with-offset
    (`"2026-01-01T00:00:00Z"`), matching the factory.
  - **Hold every axis but one equal.** Score is a lexicographic composite of
    length distance, status penalty, and novelty rank. A fixture meant to probe
    *status* must pin the same `length_hours`, `release_date` **and**
    `date_bought` on both entries, or the axis under test is not the one that
    decided the order.

**Which oracle backs which boundary.** Not all bucket edges are equal, and
treating them as equal is how an invented rule gets pinned:

| Edge | Status | Why |
|---|---|---|
| `10h` (short → medium) | **spec-backed** | FR-016 (`prd.md:160`) defines short as "< 10h", so 10 belongs to medium unambiguously. Safe to assert as a rule. |
| `30h` (medium → long) | **documentation-of-behaviour** | FR-016 says "medium (10–30h), long (30h+)" — both buckets can claim 30. An exact-30h assertion pins a coin-flip, not a requirement. |
| `60h` (long → very_long) | **documentation-of-behaviour** | Worse: FR-016 defines *three* buckets ending at "long (30h+)". `very_long` (`types.ts:104`) is a code-only fourth bucket with no FR at all. |

Assert the 10h edge; write 30h/60h cases only as behaviour records, annotated
as such in-file (`recommendation.test.ts:98-127`). A failure on a
documentation-of-behaviour row is a **decision to re-take**, not a regression.

**Three rules that keep a recommender assertion spec-side, not code-side:**

1. **De-prioritization is a direction, not an absence.** The PRD says
   100%-complete games are "de-prioritized except under comfort"
   (`prd.md:83,180`); the code *excludes* them (`isEligible`,
   `recommendation.ts:92`). `expect(order).not.toContain(id)` asserts the
   stricter code and would fail the day exclusion is legitimately softened into
   a heavy penalty. Compare **ranks** instead, treating absent as "ranked below
   everything" (the `rankOf` helper, `recommendation.test.ts:93-96`) — true
   under either implementation.
2. **Assert stability, not the tie-break key.** The PRD mandates that identical
   inputs produce identical outputs (`prd.md:84,182`); it never names
   `created_at → id`. So assert deep-equality of the **full** result (items
   *and* scores) across several permutations of one fixture
   (`recommendation.test.ts:322-425`), not the secondary order. Two reasons the
   permutation form matters: an ids-only comparison cannot see score-level
   nondeterminism, and a two-permutation check can pass on
   `Array.prototype.sort` stability (which preserves *input* order) while a
   third diverges. Include a fixture guard asserting the fixture still holds
   both a score tie and a score distinction — otherwise it can silently stop
   probing the region where ordering can wobble. Tie-break-key tests may exist,
   but label them documentation-of-behaviour (`:440-464`).
3. **Give the entry that must lose the tie-break-favoured position.** Both
   boundary assertions above would otherwise pass on luck. `statusPenalty`
   hands `completed_100` a **0** in new modes (`recommendation.ts:115`) —
   identical to `played` — so a relaxed `isEligible` produces a *score tie*,
   and the tie-break decides. Give the 100%-complete entry the older
   `created_at` and the smaller `id`: then a mere tie puts it **first** and the
   assertion fails, which is the point. Same technique for the 10h edge (the
   9.99h entry is tie-break-favoured). This is §6.6's "isolate one gate from
   the gate that masks it", applied before Stryker rather than after.

**The empty state is a two-layer contract — test the layer the user reads.**
`recommend()` emits only a machine `{status:"empty", reason, mode}`, and
`EmptyReason` has just two values (`types.ts:162`), so `mode_eligibility`
**conflates two distinct constraints**: "comfort needs a game you've played" and
"everything matching is already 100% complete". `mode` is the only
disambiguator, and `recommendationCopy.ts` → `emptyStateMessage()` is the only
place that reads it. PRD §Business Logic (`prd.md:182`) promises the empty state
"names which constraint excluded everything" — so asserting the engine returned
`mode_eligibility` proves nothing about that promise. Assert the copy:

- Match on **constraint vocabulary** traceable to the PRD's own words
  ("empty" / "played" / "100%"), plus **pairwise distinctness** across the three
  causes. Never full-string equality against the implementation's literals — a
  copy-paste mirror that breaks on an innocuous wording tweak while asserting
  nothing about meaning.
- Distinctness is the load-bearing half: vocabulary matching alone lets a
  refactor collapse the branches into one generic sentence.
- Reference: `recommendationCopy.test.ts`.
- Corollary for production code: the copy must stay in a `.ts` module under
  `src/lib/`, not in `.astro` frontmatter. `vitest.config.ts` registers no Astro
  plugin, so an `.astro` module is not importable by this harness at all — and a
  `.ts` file under `src/pages/` would publish an endpoint route as a side
  effect.

### 6.6 Hardening a phase with mutation testing (Stryker)

Once a risk phase's tests pass, run Stryker as a **selective** gate (not on
every commit) to find assertions that execute a line but wouldn't fail if it
broke. It is wired for this repo (`stryker.config.json`, `npm run test:mutation`).

- **Scope narrowly, one file per run.** Mutate only the module the phase
  covers: `npx stryker run --mutate "src/lib/services/igdb.ts"`. CLI quirk: a
  repeated `--mutate` flag *overrides* rather than accumulates, so run each
  source file in its own invocation (or list them in the config `mutate` array).
  The HTML report at `reports/mutation/index.html` is overwritten each run —
  read it before starting the next file. Stryker mutates **source**, not tests,
  so the survivor list reflects whatever suite covers that file (here the
  pure-unit `igdb.test.ts` plus the integration suite together).
- **Triage every survivor with one question:** *would this change hurt a user
  or the business?* Yes → add **one** behavioural assertion that kills it. No →
  ignore it consciously (see the discipline note). Never pin an implementation
  detail just to raise the score.
- **Kill techniques that worked here** (each adds signal, none mirrors the code):
  - *Assert the outgoing payload, not that a call happened.* The whole
    `toBase64DataUrl` encoder survived because the mocked `fetch` edge never
    checked the request body — asserting the OpenRouter body carries exactly
    `data:image/png;base64,AQIDBA==` (base64 of the fixture's bytes, an oracle)
    kills the entire encoder at once.
  - *Test the exact boundary, inclusively.* A `> limit` case only proves
    strictly-larger is rejected; a file of **exactly** 10 MB accepted pins both
    the constant and the `<=`-vs-`<` direction. Same for format mutants:
    asserting `releaseDate: "2023-10-27"` kills the epoch→ISO (`*1000`/`/1000`,
    `.slice(0,10)`) mutants a `releaseYear`-only assertion left alive.
  - *Isolate one gate from the gate that masks it.* The thin-term gate's disable
    mutant survived because the existing 1-char probe (`"e"` vs `Everwild`) is
    also rejected by the name-similarity floor. A 1-char title against a
    **perfectly-named, popular** candidate makes only the thin-term gate able to
    reject — killing the mutant.
  - *Force a flag, not a tie-break, to decide.* `isEditionEntry` was masked by
    the shortest-name tie-break in `pickBaseCandidate`. Two candidates with the
    **same display name and equal length**, one flagged by `version_title`, leave
    the edition flag as the only discriminator.
  - *Make an excluded input observable.* The `developer === true` filter survived
    until a publisher (`developer:false`) sat in `involved_companies` and the
    assertion proved it was excluded from the mapped list.
- **Conscious-ignore discipline** (log the reason, don't chase 100%):
  - *Equivalent mutants* — e.g. the base64 chunk loop `i < len` → `i <= len`:
    the extra iteration is `subarray(len, len+CHUNK)` = empty, appends nothing.
  - *Unhittable thresholds* — the `NAME_SIM_FLOOR` `<`/`<=` direction needs a
    Sørensen–Dice of exactly 0.34, unreachable without absurd token counts; the
    floor value is already pinned by the 0.333-below / 0.40-above probes.
  - *Unreachable-in-practice branches* — the `isEditionEntry` parent-relation
    terms: an edition carrying a parent relation is relation-collapsed *before*
    `pickBaseCandidate`, so those terms never decide a realistic flow.
  - *Data tables and error strings* — the platform-id map and `Response.json`
    error messages; cosmetic, not behavioural.
- **Result of the Phase 1 pass** (2026-07-20): `igdb.ts` 59.96 → 64.82,
  `identify.ts` 47.70 → 54.02 (covered 64.84 → 73.44); +5 tests, no production
  change. This is a floor, not a target — the remaining survivors are the
  consciously-ignored classes above.

### 6.7 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the phase taught.)

**Phase 1 — Grounding & identify-seam integration (2026-07-20).**

- **Abstain-asymmetry oracle correction.** The two abstain faces are *not*
  symmetric, and a test that treats them as such mirrors a misread requirement.
  Vision `unsure` → `{status:"unsure"}`, **no save** (the FR-006/US-01 manual-entry
  line). But a *confident* vision read that IGDB-misses **still saves** a row with
  `igdb_id=null, metadata_status='no_match'` — correct by design. On the harness
  path (`persist` off) that same confident-miss *folds* back to `unsure`. The
  protective assertion is that these faces stay distinct, not that any of them
  routes to manual.
- **Assert on shape, not presence.** Because a confident ground-miss also writes a
  row, "an insert ran" / "a row exists" passes against an un-grounded guess. Read
  the captured insert payload's `metadata_status` / `igdb_id`, never mere insert
  invocation.
- **Two known code gaps recorded, not fixed** (a test-writing phase changes no
  production behavior — see §7):
  - *Empty-title pass-through.* `vision.ts` validates the title with `z.string()`
    (no `.min(1)`), so a high-confidence empty title passes as `identified` and is
    auto-saved. No test written (it would mirror a probable bug or demand a
    behavior change).
  - *No ambiguity disambiguation.* `isConfidentMatch` compares only the single
    resolved base against the query — there is no multiple-close-hits detection, so
    "genuine ambiguity ⇒ abstain" is unimplemented. No test written (it would
    pretend coverage of an absent feature).
  Both are candidates for a future non-test change; see
  `context/changes/testing-grounding-identify-seam/plan.md` → "What We're NOT
  Doing".
- **Mutation-hardened (Stryker).** After the suite went green, a selective
  Stryker pass added 5 targeted assertions — one per business-relevant survived
  mutant, no implementation-pinning. Scores rose `igdb.ts` 59.96 → 64.82 and
  `identify.ts` 47.70 → 54.02. The reusable kill techniques and the
  consciously-ignored survivor classes are recorded in §6.6.

**Phase 2 — Recommender behavior hardening (2026-07-25).**

- **Verify, don't duplicate.** Research and an independent re-run both found the
  risk *already* largely covered: `recommendation.test.ts` was green at **30
  assertions** on `b1d2c59`, with behavioural (non-mirror) coverage of bucket
  edges, 100%-complete exclusion, deterministic ordering, and all three engine
  empty-state branches. Two of those were narrower than they looked: the bucket
  edges were pinned at the `bucketOf` helper only, and determinism at one
  reversed input, ids-only — which is what the added 10h end-to-end and
  permutation assertions carried the rest of the way. The phase re-asserted
  nothing already held. It added **one**
  new suite (the gap), **three** spec-direction assertions, and a mutation pass.
  A rollout phase whose honest output is "mostly already protected" is a valid
  result — the wasteful move would have been a second copy of the same coverage.
- **The one real gap was a layer boundary, not a missing case.** The engine's
  machine `reason` was well tested; the *human sentence* naming the constraint
  lived unexported in `src/pages/play-next/index.astro` frontmatter, untestable
  because `vitest.config.ts` registers no Astro plugin. Closing it cost the only
  production edit of the phase — a verbatim move of `emptyStateMessage()` into
  `src/lib/services/recommendationCopy.ts` (same signature, branches, strings),
  with the page importing it. Precedent for the pattern:
  `src/components/library/playStatus.ts`. Not `src/pages/` — a `.ts` file there
  becomes an endpoint route.
- **Two spec-vs-code divergences recorded, not fixed** (a test-writing phase
  changes no production behavior — see §7):
  - *Exclude vs. de-prioritize.* PRD `prd.md:83,180` says 100%-complete games are
    *de-prioritized* outside comfort; `isEligible` (`recommendation.ts:92`)
    *excludes* them. What makes the divergence load-bearing rather than academic:
    `statusPenalty` hands `completed_100` a **0** in new modes
    (`recommendation.ts:115`) — the *best* possible penalty, identical to
    `played` — so `isEligible` is the only thing keeping it out of a ranking. The
    new assertion compares ranks rather than asserting absence, so it holds under
    either — see §6.5 rule 1.
  - *Three spec buckets vs. four code buckets.* FR-016 (`prd.md:160`) and US-03
    (`prd.md:80`) define short / medium / long (30h+); the code ships a fourth
    `very_long` at 60h+ and relabels long as "30–60h" (`types.ts:104,124`). This
    is the root of the 30h ambiguity: the 30h and 60h edges have **no spec
    oracle at all**. §6.5 records which edge is assertable.
- **`EmptyReason` conflation — a known gap.** `mode_eligibility`
  (`types.ts:162`) means both "comfort needs a played game" and "everything
  matching is 100% complete"; the engine alone cannot name the constraint, and
  only `mode` disambiguates. Splitting the union into three values is a
  behaviour change, deliberately out of scope. The copy suite asserts the
  mode-based workaround **works**, not that it is the right design. See
  `context/changes/testing-recommender-behavior-hardening/plan.md` → "What We're
  NOT Doing".
- **Mutation pass: the wins were fixtures, not new tests.** `recommendation.ts`
  **92.36% → 94.27%** total (94.16% → 96.10% covered), 145 → 148 killed, 9 → 6
  survived, 3 uncovered. `recommendationCopy.ts` scored **100.00%** (14/14) on the first pass
  — nothing added. Both gains came from *correcting* fixtures rather than
  writing cases: the permutation suite's tied pair became a tied **triple** so
  both tie-break branches decide a real comparison (killing the constant-`-1`
  comparator mutants that break sort antisymmetry, i.e. exactly the
  input-order-dependence `prd.md:182` forbids), and the tie-break test's fixture
  had its `created_at` order *agreeing* with its `id` order — so dropping the
  `created_at` branch still produced the expected output and the test verified
  half its own name. **A green test over an undiscriminating fixture is the
  failure mode Stryker is best at exposing.** All 9 remaining items (6 survivors
  + 3 uncovered) are triaged in an in-file block (`recommendation.test.ts:32-77`);
  one of the *uncovered* is a genuine hole rather than an equivalent mutant —
  `getRecommendations`'s Supabase boundary, which no layer covers yet (Phases
  3–4). Note that `listAllEntries` behind it has no test anywhere in the repo,
  contrary to this plan's "What We're NOT Doing" bullet, which assumed
  `library.test.ts` covered it.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Auth internals (Supabase email+password signin/signup/signout)** — a
  battle-tested library integration, live in production, single trusted
  user. Test *our* route ownership/isolation (Risk #5), not the provider's
  login. Re-evaluate if we add roles, sharing, or a second auth method.
  (Source: Phase 2 interview Q5.)
- **The IGDB live API itself** — test our grounding/normalization against
  fixtures, never that the third-party service returns correct data.
  Re-evaluate if we change metadata provider. (Source: cost × signal; §1.)
- **Silent data-loss / persistence across Worker restart** — High-impact but
  Low-likelihood on managed Supabase; belongs to observability/alerting, not
  a test. Re-evaluate if we add a caching layer or self-managed storage.
  (Source: Phase 2 interview Q1 option, deliberately not promoted.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-07-18
- Stack versions last verified: 2026-07-18
- AI-native tool references last verified: 2026-07-18

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
