# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-07-18 (Phase 1 change opened: testing-grounding-identify-seam)

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
| #4 | Bucket-edge values (exactly 10h / 30h), 100%-complete de-prioritization, deterministic ordering, and the empty-state *reason* all hold. | "the happy-path top rank is correct" is not "boundaries and de-prioritization are correct." | The scoring inputs; the tie-break/determinism rule; the empty-state contract (names the excluding constraint). | unit (pure scoring function, no I/O) | Assertion copied from the scoring code it tests instead of from the FR/business rule. |
| #5 | A request authenticated as user A is rejected (or returns empty) for user B's resource id across GET / PUT / DELETE. | "an RLS policy exists" is not "the route enforces ownership." | Where ownership is actually enforced (RLS vs. handler); how to author a two-user route test with real sessions. | integration (route contract, two distinct users) | Testing only the logged-in happy path; trusting RLS without exercising a cross-user request. |
| #6 | A decimal length saves; platform aliases normalize; the server rejects what the client rejects. | "client-side validation is enough." | The zod parity between client and server; the platform normalization map. | unit + integration | Mirroring the implementation's own validation constants instead of the FR/spec. |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|----------------|-----------|--------|----------------|
| 1 | Grounding & identify-seam integration | Prove the photo path cannot silently save the wrong game/metadata | #1, #2 | integration + unit | researched | context/changes/testing-grounding-identify-seam/ |
| 2 | Recommender behavior hardening | Lock the reason-to-exist against boundary and negative-space gaps | #4 | unit | not started | — |
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

- TBD — see §3 Phase 1. Will cover: mock IGDB/vision at the network edge,
  assert edition-collapse and `no_match` behavior against the S-09 shelf
  fixture, and the read→normalize→ground→save decision (including the
  abstain→manual branch).

### 6.3 Adding an e2e test

- TBD — see §3 Phase 4. Will cover: mobile-browser camera capture →
  identify → auto-saved → visible in library.

### 6.4 Adding a test for a new API endpoint

- TBD — see §3 Phase 3. Will cover: route contract (request → response shape
  AND side-effects), ownership enforcement with two distinct users, and
  client/server zod validation parity. Mock the external HTTP edge only.

### 6.5 Adding a test for the recommender / scoring rules

- TBD — see §3 Phase 2. Will cover: bucket-boundary values, 100%-complete
  de-prioritization, determinism, and empty-state-reason contracts as pure
  unit tests.

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the phase taught.)

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
