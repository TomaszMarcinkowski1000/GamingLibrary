# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-07-27 (**Phase 4 complete**: §3 status, §4's e2e row rewritten around the three
> shipped specs + the determinism seam + the webkit decline, §5's e2e-gate contract settled for
> Phase 5, §6.3 filled in with the e2e cookbook, a §6.8 phase note, and a §7 bullet recording the
> production-change exception). Earlier the same day (Phase 4 researched): §2 Risk #3's evidence and
> response guidance rewritten from `testing-e2e-photo-flow/research.md`, Risk #2's FR citation fixed,
> §4's e2e row scoped honestly to emulated Chromium. Prior: 2026-07-25 (Phase 3 complete + mutation-hardened:
> testing-route-contracts-isolation — adds the pgTAP database-policy layer, §6.4 route recipe, and
> new §6.7; the per-rollout-phase notes moved §6.7 → §6.8)

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
| 2 | The photo identify orchestration mis-assembles — an un-normalized platform/title reaches grounding, or a `no_match`/abstain still auto-saves a guess instead of offering manual entry (**citation corrected, research 2026-07-27:** the manual-entry fallback is US-01's acceptance criterion `prd.md:58` and FR-007 `prd.md:130`; FR-006 `prd.md:126` mandates auto-save only). | High | High | interview Q1, Q3; archive `photo-to-library/plan.md`; roadmap H-03; hot-spot dir `src/lib/services` (5 commits/30d) |
| 3 | The end-to-end photo journey breaks on a mobile browser — camera capture → identify → auto-saved entry never lands visibly, or a desktop step sneaks in. | High | Medium | **Source corrected (research 2026-07-27):** the original "interview Q4" citation is unverifiable — the Phase 2 interview was conversational and never persisted, and it was the *only* likelihood evidence separating this risk from a purely PRD-derived one. Two dated, quotable equivalents say the same thing: `roadmap.md:150` (open question — does the in-browser mobile capture path work end-to-end on the four browsers, no desktop step) and archive `photo-to-library/change.md:20` (same, "validate during planning"). PRD §NFR (`prd.md:173`) + US-01 establish impact, not likelihood. |
| 4 | The recommender ranks wrong — length bucket ignored, a 100%-completed game surfaces outside comfort mode, ordering is non-deterministic, or an empty list appears instead of an explained empty-state. | High | Medium | PRD §Business Logic (the reason-to-exist); FR-015, FR-016, FR-018; US-03 |
| 5 | Cross-user library exposure (IDOR / RLS gap) — a request authenticated as user A mutates or deletes user B's entry (and reads it back in the mutation's response), or a list / facet read returns another user's rows. Isolation rests on a single database policy layer, so one policy edit or credential swap breaches it with no application code change. | High | Low–Med | PRD §NFR (per-user isolation); PRD §Access Control (open sign-up = real multi-user); abuse/security lens |
| 6 | Input-boundary regressions in the add/edit path — validation strictness diverges between the browser form, the server schema, and the database column, so a value one layer accepts another silently truncates, rejects, or fails as a 500 instead of a 400. | Medium | Medium | archive H-01/H-02/H-03 (v1 hardening). **Churn evidence corrected (research 2026-07-25):** `src/components/library` is **10 commits all-time**, not 10/30d — 3 in the window this plan was authored in, 0 in the 30 days since. Likelihood now rests on the archive evidence alone, which research confirmed is genuine. |

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
| #3 | On an **emulated** mobile browser, capture → identify → auto-save → entry-visible completes with no required desktop step. **Sharpened by research (2026-07-27):** "entry-visible" is not automatic — a photo-saved row is invisible in the SSR list until the post-close client navigation runs; nothing else re-fetches the list. That navigation *is* the risk, and asserting the row after the dialog closes is the assertion that carries it. | **Rewritten by research (2026-07-27).** The original cell ("works on desktop Chrome" is not "works on mobile Safari camera") is **unsatisfiable by this harness** — Chromium-only, with a Chromium-based Pixel 5 descriptor; it can never run mobile Safari, so leaving it in place makes a green spec read as a promise the harness structurally cannot make. Two challenges that hold instead: (i) **"the emulated journey passes" is not "the failure that produced this risk cannot recur"** — the ~80% failure that forced the `<input capture>` → `getUserMedia` rewrite was the OS camera app evicting the page and dropping the in-flight request; no emulator reproduces OS app-switching, so reintroducing `<input capture>` would leave an emulated spec green. (ii) **"a Pixel 5 spec is green" is not "the browser NFR is met"** — `prd.md:173` demands latest-two across four browsers × two form factors; one Chromium project covers ~1 of 16 cells. | The capture entry point and the pointer-type gating of it; the client navigation that makes the saved row visible; what the abstain path shows the user; and **whether any deterministic seam exists for the vision/IGDB providers** (research: none does — the endpoint is a hardcoded const and Playwright's `webServer.env` cannot reach the Worker, since `.dev.vars` beats `process.env`). | e2e (Playwright) — **confirmed and stronger than stated**: no cheaper layer covers the browser + camera journey, and no cheaper layer *exists* for any React component here (node environment, `.tsx` never collected, no jsdom/testing-library). | e2e-ing what the §6.2 integration suite already covers (grounding/seam logic — 37 assertions, including both auto-save faces). Assert **journey shape**, never a title, `igdb_id`, or `metadata_status` value. Second anti-pattern research measured: a spec that omits the fake-camera launch args passes green while silently exercising the *file-input* path it was written to avoid. |
| #4 | The spec-clean bucket edge (exactly 10h → medium) holds; 100%-complete games are de-prioritized outside comfort; ordering is stable for identical inputs; and the empty state *names the constraint that excluded everything* — in the copy the user actually reads, not only in the engine's machine `reason`. | "the happy-path top rank is correct" is not "boundaries and de-prioritization are correct." Also: "the engine returned `mode_eligibility`" is not "the user was told which constraint excluded everything." | The scoring inputs; the tie-break/determinism rule; the empty-state contract, including **which layer owns the human sentence** naming the constraint. | unit (pure scoring function, no I/O) | Assertion copied from the scoring code it tests instead of from the FR/business rule. Three known oracle hazards (research 2026-07-25): (i) **30h is spec-ambiguous** — FR-016 "medium (10–30h), long (30h+)" lets both buckets claim 30, so an exact-30h assertion pins an invented rule; assert 10h, and treat any 30h case as documentation-of-behaviour, not spec; (ii) the spec says 100%-complete games are *de-prioritized*, the code *excludes* them — asserting absence tests the stricter code, not the rule; (iii) the PRD mandates determinism but not the specific `created_at → id` tie-break key — assert same-input-same-output, not the secondary order. |
| #5 | A request authenticated as user A is rejected (404) for user B's resource id across **PUT / PATCH / DELETE** — there is no GET-by-id route, and PATCH was missing from this cell — and a list / facet read returns only A's rows. | **Inverted by research (2026-07-25).** The route deliberately does *not* enforce ownership; RLS is the sole gate, by a decision ratified in the H-04 edit/delete change. So the challenge runs the other way: **a stubbed-Supabase route test proves nothing about isolation** while reading as coverage. Second challenge: "it returned 404" is not "isolation held" — a partially-broken policy set can answer 404 on a row it just successfully mutated (the 404 is derived from an empty RETURNING set, not from a permission error). | That ownership lives entirely in the database policy layer; that the `anon` role holds full table grants, so a *missing policy* is the whole defense rather than a second line of it; and which failure modes are invisible to a stub (policy dropped or widened to `anon`, anon key swapped for a service key, `security invoker` flipped to `definer`). | **Split, because the failure sets are disjoint:** SQL policy tests (pgTAP via `supabase test db`) for isolation itself; hermetic route tests (direct handler invocation) for the 404/status contract. | Proving isolation with a stubbed client — a tautology, and worse than no test because it reads as coverage. Enumerating one assertion per filter dimension: search/filter is the same single RLS dependency, not extra surface (no raw PostgREST filter strings exist, so no user input can escape the row-security qualifier). |
| #6 | The three validation layers either agree, or their disagreements are recorded deliberately: `patchEntrySchema` and its client that bypasses HTML5 validation entirely, the rounding divergence between the client and the enrichment path, and values that satisfy the schema but overflow the column. | **Corrected by research (2026-07-25).** "Client-side validation is enough" is not the live assumption — **there is no client-side zod at all**; the client is two `.trim()` truthiness checks plus HTML5 input attributes. And two of the three original probes are inverted: *"a decimal length saves"* passes at the schema layer while the browser still blocks it (the real defect is that such a row becomes wholly un-editable — an FR-010 must-have violation), and *"platform aliases normalize"* asserts a feature the H-03 change deliberately scoped out of the manual path, so it would fail against correct code. | Which layer owns each constraint; and which divergences have a PRD oracle (`prd.md:70`, `:94`, `:140`) versus which are documentation-of-behaviour with no spec behind them (platform canonicalization, integer-vs-decimal length, and every upper bound). | unit (the uncovered schemas) + integration (route contract) | Mirroring the implementation's own validation constants instead of the FR/spec. Asserting an unbuilt feature (manual-path normalization). Asserting at a layer that structurally cannot see the bug (a schema test for a browser-side rejection). |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|----------------|-----------|--------|----------------|
| 1 | Grounding & identify-seam integration | Prove the photo path cannot silently save the wrong game/metadata | #1, #2 | integration + unit | complete | context/changes/testing-grounding-identify-seam/ |
| 2 | Recommender behavior hardening | Lock the reason-to-exist against boundary and negative-space gaps | #4 | unit | complete | context/changes/testing-recommender-behavior-hardening/ |
| 3 | API route contracts + cross-user isolation | Prove the database enforces ownership and that the route contract translates it faithfully | #5, #6 | db-policy (pgTAP) + integration | complete | context/changes/testing-route-contracts-isolation/ |
| 4 | End-to-end photo flow | Exercise the mobile capture → identify → visible journey once | #3 | e2e | complete | context/changes/testing-e2e-photo-flow/ |
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
| unit + integration | Vitest | **4.1.10** (`package.json`; verified 2026-07-25) | Configured; **12 test files / 235 tests** (re-measured 2026-07-27; Phase 4 added `src/lib/services/vision.test.ts`, the seam's 4-case guard), green in ~3s — `src/lib/*` plus `src/pages/api/identify.test.ts` and the two `src/pages/api/library/` route suites (Phase 3). `npm test` = `vitest run`. Vitest 4 deltas that bite: `test.workspace` → `test.projects`, and the `basic` reporter was removed. |
| API / provider mocking | `vi.mock` + `installFetchRouter` at the `globalThis.fetch` edge | shipped in Phase 1 | `test/helpers/fetch-mock.ts`; `test/setup/no-network.ts` denies unrouted fetch suite-wide. Mock IGDB/vision HTTP at the edge; never mock internal grounding. |
| Route contract (API endpoints) | Direct handler invocation + cast `APIContext` | shipped in Phase 1 | `src/pages/api/identify.test.ts` imports the exported handler and hands it `{ request, params, cookies, locals }`. **No Miniflare/workerd needed** — and per Cloudflare's own docs `vi.mock` cannot intercept `@cloudflare/vitest-pool-workers`' injected entry-point, which would discard this repo's whole mocking strategy. The Astro Container API adds only real `AstroCookies`/`params` and still runs no middleware. checked: 2026-07-25 |
| Database policy (RLS) | pgTAP via `supabase test db` | Supabase CLI 2.x (devDependency) | **Shipped in Phase 3**: `supabase/tests/database/library_entries_rls.test.sql`, **17 assertions**, run with `npm run test:db` (requires Docker + `npx supabase start`; deliberately outside `npm test`). pgTAP is created inside the test transaction and rolled back — no migration. Recipe in §6.7. This is the only layer that can prove Risk #5. checked: 2026-07-25 |
| e2e | Playwright | **1.62.0** (`package.json`; verified 2026-07-27) | **Risk #3 covered (Phase 4, 2026-07-27).** `playwright.config.ts` + `e2e/`: setup project → `storageState`, `RULES.md`, and **three specs** — `seed.spec.ts` (manual-add persistence), `photo-capture-mobile.spec.ts` (the camera journey), `photo-gallery-desktop.spec.ts` (the fine-pointer journey + the only execution of `downscaleImage` at any layer). `npm run test:e2e`, ~30s. Needs `npx supabase start`, a dedicated `E2E_EMAIL`/`E2E_PASSWORD` user, and `E2E_VISION_STUB_KEY` — see below. Chromium only; mobile is per-spec `test.use({ ...devices["Pixel 5"] })`, not a second project.<br>**The run is now offline and provider-free.** Phase 4 added a key-guarded seam (`stubbedVisionRead`, `src/lib/services/vision.ts`) that replaces the OpenRouter hop only, so the suite needs **no outbound network and no `OPENROUTER_API_KEY`**; it needs `E2E_VISION_STUB_KEY` in **both** `.dev.vars` (server) and `.env` (spec side), and a dev-server restart after editing `.dev.vars` (`.dev.vars` beats `process.env`). Fixtures are committed and generated in-repo (`e2e/fixtures/`, `scripts/make-e2e-fixtures.mjs`): a single-frame Y4M for the fake camera and a **1600×1200** JPEG that must stay above `DEFAULT_MAX_EDGE = 1024` or the downscale branch stops running.<br>**Scope, stated rather than implied: this row does not deliver "a real mobile browser."** `devices["Pixel 5"]` is Chromium with a mobile UA, 393×727 viewport, `isMobile`/`hasTouch`. Measured true: it *does* flip `pointer: coarse`, so the app's mobile capture affordance is genuinely under test, and the real `getUserMedia` → canvas → JPEG pipeline runs against a fake device — but only with **both** `--use-fake-device-for-media-stream` and `--use-fake-ui-for-media-stream` (either alone fails, and the failure is silent: the app falls back to the file picker). Against `prd.md:173` (latest-two × four browsers × two form factors) this is ~1 of 16 cells. **`webkit` is declined in writing (Phase 4, Decision 3):** the fake-media args are Chromium-only, so a WebKit run of the camera spec would silently exercise the file-input path — and WebKit is not iOS Safari anyway. The four-browser NFR keeps its manual-matrix home (`context/archive/2026-06-17-photo-to-library/plan.md:230-237`). Not exercisable at all: **mobile Safari**, a real camera/permission prompt, OS-level page eviction (the ~80% failure that forced the `<input capture>` → `getUserMedia` rewrite — no emulator reproduces OS app-switching), the real provider integration (moved to manual / pre-prod smoke), and the 10 s p95 latency NFR. |
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
| db policy (RLS) | **local only** (`npm run test:db`) | required after §3 Phase 3 | policy drift — a policy dropped, widened to `using (true)` (incl. UPDATE widened alone, caught only by the unfiltered-write assertion — see §6 rule 3), or opened `to anon`; a lost INSERT `WITH CHECK`; an RPC's `user_id` predicate removed |
| e2e on critical flows | CI on PR | required after §3 Phase 4 (**now due** — Phase 4 landed 2026-07-27) | broken photo journey: camera capture, the client-side downscale, and the post-close navigation that makes an auto-saved row visible at all |
| post-edit hook | local (agent loop) | recommended (optional) | regressions at edit time on the service layer |
| pre-prod smoke | between merge + prod | optional | Worker/edge-specific failures the local suite misses |

CI today (`.github/workflows/ci.yml`) runs lint + build only; §3 Phase 5
wires `npm test` (required after Phase 1) and the e2e gate (after Phase 4).
The db-policy gate is **enforced locally** and its CI wiring is Phase 5's too —
it needs a Supabase service container, and adding one before `npm test` itself is
gated would absorb Phase 5's work on top of a gate that does not exist yet.

**The e2e gate's contract, settled by rollout Phase 4 so §3 Phase 5 inherits it
rather than rediscovering it** (2026-07-27): the suite needs **no outbound network
and no `OPENROUTER_API_KEY`** — the vision seam removes the provider hop. It does
need three things. (1) A Supabase service container plus a confirmed
`E2E_EMAIL`/`E2E_PASSWORD` user seeded in it. (2) `npx playwright install --with-deps
chromium`. (3) **CI must write `.dev.vars` from repository secrets before starting
the dev server**, carrying `SUPABASE_URL`, `SUPABASE_KEY`, and `E2E_VISION_STUB_KEY`
— setting them as plain env vars is not enough, because wrangler reads `.dev.vars`
first and consults `process.env` only when that file is absent, and Astro binds
secrets once at worker init. The same `E2E_VISION_STUB_KEY` value must also reach
the runner's `.env`/`process.env`, which is where the specs read it to send the
header. One mechanism for local and CI both.

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

**Read `e2e/RULES.md` first, and model the spec on `e2e/seed.spec.ts`** — those two
files are the quality levers for this layer, and a generator reproduces whatever the
seed shows. What follows is only the orientation.

- **Earning a spec here is the hard part, not writing one.** A risk qualifies when it
  crosses several real boundaries at once (auth → middleware → SSR → API → RLS insert)
  or exists only in the hydrated UI. If §6.4's route-contract layer or §6.7's pgTAP
  suite could prove it, it belongs there — they are faster and far less flake-prone.
  Budget: **one test per risk**, and no test-per-page.
- **Location / naming**: `e2e/<feature>.spec.ts`, one test per file. Name the test after
  the risk (`"manually added game is still in the library after a reload"`), never
  `"test 1"`.
- **Run locally**: `npx supabase start`, then `npm run test:e2e` (Playwright starts the
  dev server itself), or `npm run test:e2e -- e2e/seed.spec.ts` for one spec. Requires
  `E2E_EMAIL` / `E2E_PASSWORD` in `.env` — a dedicated confirmed user in the local
  instance, not a personal or production account.
- **Auth never goes through the UI.** The `setup` project (`e2e/auth.setup.ts`) signs in
  once via the real `/api/auth/signin` route and saves `e2e/.auth/user.json`; every spec
  inherits it via `storageState`. Gotcha worth knowing: Astro's `security.checkOrigin`
  rejects an API-side form POST with a bare 403 unless you set `Origin` yourself.
- **Real vs mocked**: Supabase auth, middleware, routing, and the DB stay **real** —
  that's the whole point of the layer. IGDB and the vision provider are called
  **server-side**, so `page.route()` cannot intercept them; the seed sidesteps this with
  a timestamped title that can never match, and asserts nothing about metadata.
- **Verify it protects the risk**: break the production behavior on purpose, watch the
  spec go red, revert the break. An assertion that stays green through the break is
  decorative. Never commit the break.

**The three reference specs and what each owns** (Phase 4, 2026-07-27):

| Spec | Owns | Runs as |
|---|---|---|
| `seed.spec.ts` | manual add → persists across a real SSR reload | desktop `chromium` |
| `photo-capture-mobile.spec.ts` | **Risk #3's headline**: coarse-pointer dropdown → in-page camera → identify → auto-save → **visible row** | `devices["Pixel 5"]` + fake-media args |
| `photo-gallery-desktop.spec.ts` | the fine-pointer half: real `downscaleImage` in the browser, and *no* camera step on desktop | desktop `chromium` |

**Mobile emulation is per-file, not a second project.** `test.use({ ...devices["Pixel 5"],
launchOptions: { args: [...] } })` at the top of the one spec that needs it. A second Playwright
project would make the whole suite pay for a second full run
(`playwright.config.ts:59-61`); overriding `launchOptions` forces a fresh browser for that
worker only. Measured true and load-bearing: `devices["Pixel 5"]` really does flip
`pointer: coarse`, which is what makes the mobile capture affordance reachable at all — both
branches are always in the DOM, differentiated only by `display:none`
(`PhotoCapture.tsx:197-240`), so `getByRole("button", { name: "Add via photo" })` resolves to
exactly one element in each mode.

**Deterministic providers: a seam replaces the network hop, never the normalizers.** The vision
provider is called server-side, so it cannot be intercepted from the browser and `webServer.env`
cannot reach the Worker either (`.dev.vars` beats `process.env`). The answer shipped in Phase 4 is
`stubbedVisionRead` (`src/lib/services/vision.ts`): a request proving knowledge of the server-side
`E2E_VISION_STUB_KEY` gets a canned `identified` read. Everything else on the route — auth,
multipart parse, size/mime validation, `vision.ts`'s normalizers, grounding, the insert, the SSR
re-render — stays real. **Two independent locks** (the secret must be set *and* the request must
present it), both absent in production and both proven at the Vitest layer
(`src/lib/services/vision.test.ts`, 4 cases); the whole suite runs with the key `undefined`, so it
is standing evidence the default state is dead. Arm it by intercepting the app's **own same-origin**
`POST /api/identify` and adding headers with `route.continue()` — never by fulfilling a canned
response. Full recipe, plus the `.dev.vars`/`.env` two-copy rule and the restart trap, in
`e2e/RULES.md`.

**The falsification log is a file-header convention here**, mirroring §6.7's pgTAP table: a
`| break | assertion that reddens | observed |` table in each spec's header, filled in by
experiment. Phase 4's most informative row is the one that reddens *only* here — dropping `entry`
from the identify response (`identify.ts:192`) degrades the review dialog to add-mode while all 235
Vitest tests stay green (measured 2026-07-27).

**Two anti-patterns, with the symptom each presents:**

1. *Omitting a fake-media launch arg.* Both `--use-fake-device-for-media-stream` and
   `--use-fake-ui-for-media-stream` are required; either omission fails **silently in the app's
   favour** — `CameraCapture` routes to `onError` and the UI falls back to the gallery picker, so
   the spec passes green while exercising the file-input path it was written to avoid. Permanent
   guard: assert the camera dialog is visible **with Capture enabled** (`disabled={!ready}` flips
   only when `getUserMedia` resolves).
2. *Re-asserting §6.2's territory.* No spec at this layer reads a title, an `igdb_id`, or a
   `metadata_status` — the integration suite owns the identify seam at 37 assertions. Assert journey
   *shape*.

Two smaller traps worth inheriting: **island hydration** (Astro islands ship interactive-looking SSR
HTML before React attaches, so a click immediately after `goto` can be swallowed — retry the click
while waiting on what it should reveal, never sleep), and **locator punctuation** (`PhotoCapture`'s
copy uses U+2019 and em dashes; an ASCII `couldn't` will not match — copy literals from source).

### 6.4 Adding a test for a new API endpoint

**Read the boundary first: this layer proves contract translation, never
ownership.** Every route test here runs against a *stubbed* Supabase client, so
its assertions would return exactly the same result with RLS disabled entirely.
A 404 in a route test means "an empty result set became a 404", not "user B
cannot touch user A's row". Isolation is proven one layer down, in §6.7. Say so
in the file header — `src/pages/api/library/[id].test.ts:4-22` is the model — or
the next reader will bank the 404 test as isolation coverage it is not.

- **Location / naming**: co-located with the route,
  `src/pages/api/<path>/<route>.test.ts` (`library/[id].test.ts`,
  `library/index.test.ts`, `identify.test.ts`).
- **Run locally**: `npm test`, or `npx vitest run "src/pages/api/library/[id].test.ts"`.
- **The pattern is direct handler invocation.** Import the exported `GET`/`POST`/…
  and hand it a hand-built, cast `APIContext`. No Astro machinery, no HTTP server,
  no Miniflare — see §4 for why `@cloudflare/vitest-pool-workers` and the Container
  API were both rejected. The factory is ~10 lines:

  ```ts
  // `PUT` is the imported handler; `ENTRY_ID` is a fixture const the suite defines itself.
  function context(opts: { method: string; id?: string; body?: unknown; user?: unknown }) {
    const { method, id = ENTRY_ID, user = { id: "user-1" } } = opts;
    const init: RequestInit = { method };
    if (opts.body !== undefined) {
      init.body = JSON.stringify(opts.body);
      init.headers = { "Content-Type": "application/json" };
    }
    const request = new Request(`https://test.local/api/library/${id}`, init);
    // `params` only for a dynamic route; `cookies`/`locals` are what the handler destructures.
    return { request, params: { id }, cookies: {} as never, locals: { user } } as unknown as Parameters<typeof PUT>[0];
  }
  ```

- **Supabase goes in through a hoisted holder**, so each test can swap the stub
  (or `null`) without re-mocking:

  ```ts
  const holder = vi.hoisted((): { supabaseClient: unknown } => ({ supabaseClient: null }));
  vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => holder.supabaseClient) }));
  ```

  The chainable stubs live in `test/helpers/supabase-mock.ts` — import them via the
  **`@test/*` alias** (`import { updateClient } from "@test/helpers/supabase-mock"`),
  not a relative path. The builders are `insertClient` / `updateClient` /
  `deleteClient` / `listClient` / `selectLimitClient` / `filterListClient`;
  `insertClient()` takes no arguments, the rest take the `{ data, error }` result
  the terminal call should resolve to. Each captures what flowed through it (the
  patch payload, the `.eq()` args, the `.select()` column string). Reach for an
  existing builder before writing a seventh inline copy.

- **Two cost tiers — do not pay for the one you don't need.**
  - *Cheap*: `library/[id].ts` imports neither `cloudflare:workers` nor IGDB, so
    its suite needs no KV mock and no fetch router at all.
  - *Expensive*: `library/index.ts` and `identify.ts` reach the enrichment edge, so
    they add `vi.mock("cloudflare:workers", () => ({ env: { IGDB_TOKENS: {} } }))`
    (a `{}`-shaped KV forces a token-cache miss) plus `installFetchRouter` (§6.2).
    Keep the 400-path tests *outside* that setup: with the suite-wide deny-all
    fetch (`test/setup/no-network.ts`) still armed, a validation-ordering change
    that let a rejected body reach IGDB fails loudly instead of passing quietly.

- **The vacuous-401 trap.** The four Supabase-touching library handlers —
  `[id].ts`'s PUT/PATCH/DELETE and `index.ts`'s POST — check `if (!supabase)`
  **before** `if (!locals.user)`, and `test/stubs/astro-env-server.ts` leaves
  `SUPABASE_*` undefined on purpose. So a 401 test written *without* the
  `@/lib/supabase` mock hits the 500 branch — it either fails outright, or (worse)
  passes for the wrong reason if it was written as `not.toBe(200)`. Assert **both
  faces**, each labelled: mocked client + no user → 401; `createClient` → `null` +
  no user → 500 "Supabase is not configured" (documentation-of-behaviour; it is in
  tension with `prd.md:188` and is recorded, not fixed).
  **Check your route's own guard order before copying this.** The fifth route in
  the same directory, `library/lookup.ts`, does *not* fit the pattern: it never
  builds a Supabase client, so it checks `!locals.user` first and has no 500 face
  at all. Assert both faces only where both exist.

- **Assert the outgoing call, not only the status.** Phase 1's impl-review (F2)
  recorded that a best-effort `catch` lets a status-only assertion pass even with
  the stub removed. Read the captured `.eq()` args, the captured patch, the
  captured insert payload — "a 404 came back" is not "the right id went out", and
  "a 201 came back" is not "the right row was written".

- **Discriminate 404 from 500 on every verb.** A not-found translation is only
  half the contract; the other half is that a *real* database failure does **not**
  get dressed up as a 404. Telling a user their entry is gone when a DELETE timed
  out means they never retry. Phase 6's mutation pass found exactly this gap on
  PATCH and DELETE (`if (error instanceof EntryNotFoundError)` → `if (true)`
  survived on both).

- **Error messages: attribution and distinctness, never the literal.** The routes
  hand `parsed.error.issues[0]?.message` straight to the client, which renders it
  verbatim (`src/components/library/GameDialog.tsx:225`,
  `src/components/library/PlayStatusControl.tsx:78`). Pinning the text
  mirrors zod and breaks on an upgrade; asserting nothing lets every failure
  collapse into one generic sentence. Match the field name (`/title/i`) where the
  message has one, and assert pairwise distinctness where it doesn't.

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

### 6.7 Adding a database policy (RLS) test

The layer that owns **ownership**. Nothing above it can: the application writes
exactly one predicate (`.eq("id", id)`) and deliberately filters by no `user_id`
at all (`src/lib/services/library.ts:31-33`, a decision ratified in the H-04
edit/delete change). So a policy test is not a redundant second opinion on a
route test — it is the *only* evidence isolation holds.

- **Location / naming**: `supabase/tests/database/<table>_<concern>.test.sql`.
  Reference suite: `library_entries_rls.test.sql`.
- **Run locally**: `npm run test:db` (= `supabase test db`). Requires Docker and
  the local stack (`npx supabase start`, ~60–120s cold). Deliberately **separate
  from `npm test`**, which stays hermetic and Docker-free at ~3s.
- **The skeleton.** pgTAP is created *inside* the test transaction and rolled
  back, so there is no migration to write and no deployed schema is touched:

  ```sql
  begin;
  create extension if not exists pgtap with schema extensions;
  select plan(N);                     -- N must match the assertion count exactly

  -- fixture (see below), then the assertions
  select * from finish();
  rollback;
  ```

- **The fixture needs real auth users.** `library_entries.user_id` FKs to
  `auth.users(id)`, so rows cannot exist without them. Only `id` is NOT NULL
  without a default; supply `email` too, since gotrue's own lookups expect one:
  `insert into auth.users (id, email) values ('…uuid…', 'user-a@test.local');`
  Give the two users **disjoint** column values, so a leak surfaces as a *present
  extra value* rather than as a count mismatch.
- **Impersonation idiom** — two `set local`s, scoped to the transaction:

  ```sql
  set local role authenticated;
  set local request.jwt.claim.sub = '…the user''s uuid…';
  ```

  It works because `auth.uid()` in this database is
  `coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid`
  (verified live 2026-07-25). Source: Supabase docs via Context7
  `/supabase/supabase`, **checked: 2026-07-25**. `reset role` returns to the
  BYPASSRLS role the test connects as — which is how you observe what a blocked
  write actually did to the table.

**Three rules this phase learned. Each one is the difference between a suite that
proves something and a suite that looks like it does:**

1. **Positive control first.** If `set local request.jwt.claim.sub` silently fails
   to take effect, `auth.uid()` is NULL, `auth.uid() = user_id` evaluates to NULL,
   and *every row is hidden from everyone* — so every "B cannot see A's rows"
   assertion passes while proving nothing. Open the file by asserting `auth.uid()`
   is who you think it is, and that the user can see and write their *own* row.
   Measured on this suite (2026-07-25): with the claim deleted, **8 of its 17
   assertions stayed green** over a NULL `auth.uid()` — every cross-user write,
   read, foreign-insert and `anon` assertion it has. Only the positive control and
   the "B sees B's own data" assertions went red. Without group (a), that is a
   suite reporting full isolation coverage while proving nothing.
2. **Assert the effect, not just the RETURNING set.** Prefer `is_empty` over the
   documented `results_ne($$ … returning 1 $$, $$ values(1) $$)` idiom —
   `results_ne` passes for *any* set differing from `{(1)}`, including a two-row
   breach. Then go further and assert the **table**: `reset role` and check the
   other user's rows still carry their original values and still exist. An empty
   RETURNING set is evidence about the statement's output, not about the data.
   **Do not repeat the disproved rationale for this rule.** An earlier draft
   claimed a widened UPDATE policy over a narrow SELECT policy lets the write
   *land* while `RETURNING` filters to empty — "a 404 over a mutated row". That
   state is **not reachable**: Postgres applies SELECT policies to UPDATE/DELETE
   carrying a `WHERE` or `RETURNING` clause, so widening UPDATE alone changes
   nothing **for statements carrying one of those clauses**, and dropping SELECT
   blocks the write outright. Measured 2026-07-25; the rule stands on the two
   reasons above.
3. **Assert one write with neither a `WHERE` nor a `RETURNING` clause.** The
   qualifier in rule 2 is load-bearing and easy to lose. A bare
   `update <table> set <col> = …;` gets no SELECT-policy composition, so a widened
   UPDATE policy alone *does* cross users for it — and every WHERE-carrying
   assertion in the suite stays green, silently rescued by the narrow SELECT
   policy. In `library_entries_rls.test.sql` this is test 8, the only assertion
   that reddens on "UPDATE widened alone" (measured 2026-07-25). Write it against
   a column no later assertion reads, so it cannot disturb them. That the
   application only ever issues filtered writes is an app-layer argument; a DB
   policy suite owns the database's terms.
4. **Include an `anon`-role assertion.** `anon` holds full table grants
   (`DELETE,INSERT,SELECT,UPDATE,…` — Supabase defaults), so the *absence of an
   anon policy is the entire wall*, not a second line behind it. A policy widened
   `to anon` or `for all using (true)` is one line of SQL from a full breach and is
   completely invisible to a suite that only impersonates authenticated users.

**Falsify the suite before trusting it, and write down what you saw.** A suite
nobody has watched fail is a suite nobody has reason to trust. Inject each breach
into a scratch copy inside the same rolled-back transaction, record which test
numbers go red, and keep the table in the file header
(`library_entries_rls.test.sql:57-78`). It is what turns "these tests pass" into
"these tests discriminate" — and it is how the group-(d) caveat below was
confirmed rather than assumed.

**What this layer cannot prove** — record it in the header so nobody over-reads
the coverage:

- **A `SUPABASE_KEY` swapped for the service key.** `service_role` and `postgres`
  carry `rolbypassrls = t`: every guard still passes and every query silently
  returns all users' rows. pgTAP never goes through the app's client, so no
  database test can see it. It is a deployment concern
  (`context/changes/deployment/deployment-plan.md:107`).
- **A `security invoker` → `definer` flip on an RPC.** Both facet RPCs carry an
  explicit `user_id = (select auth.uid())` predicate *in addition* to RLS, so the
  RPC assertions prove the predicate holds — not that RLS is still the backstop
  behind it. Confirmed by falsification: those tests survive a widened SELECT
  policy and only go red once the predicate is also gone.

### 6.8 Per-rollout-phase notes

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
- **Three known code gaps recorded, not fixed** (a test-writing phase changes no
  production behavior — see §7):
  - *Empty-title pass-through.* `vision.ts` validates the title with `z.string()`
    (no `.min(1)`), so a high-confidence empty title passes as `identified` and is
    auto-saved. No test written (it would mirror a probable bug or demand a
    behavior change).
  - *No ambiguity disambiguation.* `isConfidentMatch` compares only the single
    resolved base against the query — there is no multiple-close-hits detection, so
    "genuine ambiguity ⇒ abstain" is unimplemented. No test written (it would
    pretend coverage of an absent feature).
  - *No redaction on the grounding-error path.* `identify.ts` GET returns the
    caught `error.message` **verbatim** in its 502 body. The planned leak-guard
    test (stub IGDB to throw an error whose message embeds a token-like string)
    would therefore have gone red, so it was weakened to a benign upstream 500 —
    the assertion now only trips if the IGDB wrapper itself starts embedding
    credentials in its error text. It is a regression tripwire, not proof of
    redaction. Closing this means mapping the catch to a status-only message.
  All three are candidates for a future non-test change; see
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

**Phase 3 — API route contracts + cross-user isolation (2026-07-25).**

- **§2's response guidance was inverted for both risks, in opposite directions —
  and research, not the plan, was the ground truth (§1 principle #3).** For Risk #5
  this plan asked for a route test proving "user A is rejected for user B's id".
  The route deliberately enforces *no* ownership: RLS is the sole gate, by a
  ratified decision, and the only predicate the app writes is `.eq("id", id)`. A
  stubbed-Supabase route test therefore proves nothing about isolation **while
  reading as coverage** — the anti-pattern §2 itself names. For Risk #6, two of the
  three probes were unwritable as specified: "a decimal length saves" passes
  trivially at the schema layer while the real defect lives in the browser, and
  "platform aliases normalize" asserts a feature H-03 deliberately scoped out of
  the manual path, so it would fail against correct code. Both cells in §2 were
  rewritten to match. **The lesson is procedural, not local**: a risk-response cell
  written before research can name the wrong layer, and following it produces green
  tests that defend nothing.
- **The answer was a new layer, not more tests.** Risk #5 got the repo's first
  pgTAP suite (§6.7) because it is the only layer that can see the failure. Risk #6
  got schema and route-contract tests (§6.4). The two failure sets are disjoint;
  running both is not redundancy.
- **Three code gaps recorded, not fixed** (a test-writing phase changes no
  production behaviour — see §7). All three are traceable to
  `context/changes/testing-route-contracts-isolation/plan.md` → "What We're NOT
  Doing", where each is written up with its oracle (or its absence):
  - *A fractional `length_hours` row is wholly un-editable.* The edit form's
    `<Input type="number">` carries no `step` (`GameFormFields.tsx:197-205`), so the
    browser's implicit `step="1"` blocks the **entire form submit** — no field can
    be changed on such a row. This violates `prd.md:140` FR-010 ("edit any field",
    must-have) and is **the one gap with a must-have spec oracle behind it**;
    flagged for a follow-up change. Not fixed here because no layer in this phase
    can verify the fix — only a browser can (Phase 4).
  - *Manual-path platform normalization.* A photo read of `PS5` persists as
    `PlayStation 5`; a user who types `ps5` persists `ps5`. Deliberately scoped out
    by H-03, no PRD oracle. Characterized as a behaviour record in
    `library/index.test.ts`, not corrected.
  - *`22003` / `22P02` → 500 instead of 400.* An out-of-`int4` `release_year` or a
    non-UUID `params.id` reaches Postgres and lands in the route's catch-all: a
    client mistake reported as a server fault. No PRD oracle bounds either.
  - Also pinned rather than fixed: the **500-before-401 guard order**. All four
    library handlers check `if (!supabase)` before `if (!locals.user)`, so an
    anonymous caller against a misconfigured deploy learns "Supabase is not
    configured". In tension with `prd.md:188`; asserted as documentation-of-behaviour
    on both faces (see §6.4's vacuous-401 trap, which is the same fact seen from the
    test side).
- **Mutation pass — scope limitation, stated plainly.** Stryker mutates TypeScript
  source, so it **cannot touch the pgTAP layer: Risk #5's actual defense got no
  mutation signal at all.** This pass hardened Risk #6 and the route contract only,
  over two files: `src/pages/api/library/[id].ts` **63.91% → 69.92%** (85 → 93
  killed, 28 → 26 survived, 20 → 14 uncovered) and `src/lib/validation/library.ts`
  **80.28% → 91.55%** (57 → 65 killed, 14 → 6 survived). What stands in for mutation
  testing at the SQL layer is the **falsification log** in the suite header — seven
  injected breaches, each with the test numbers it reddens. Slightly different
  instrument, same question: *would this test notice?*
  - CLI quirk worth knowing: the `[` `]` in `[id].ts` are glob metacharacters, so
    `--mutate "src/pages/api/library/[id].ts"` silently matches **nothing** (Stryker
    warns, then dry-runs). Address the file as `"src/pages/api/library/?id?.ts"`.
  - Kill techniques that earned their assertion here: **discriminate the sad paths
    from each other** — both `if (error instanceof EntryNotFoundError)` checks
    survived as `if (true)`, i.e. every database failure reported as "Entry not
    found", which on DELETE tells the user their row is gone when it is not. And
    **anchor the pattern, not just the shape**: dropping `^`/`$` from the ISO-date
    regex lets any string *containing* a date validate, which fails two layers later
    as a 500.
  - Conscious ignores are triaged in-file, per §6.6 discipline
    (`[id].test.ts:24-62`, `validation/library.test.ts:4-40`). The recurring classes:
    error-copy literals the client has its own fallback for, `Response.json(x, {})`
    on paths that already default to 200, `prerender = false` (build-time config no
    harness can see), and the `if (!id)` guards — unreachable because Astro's file
    router never dispatches `[id].ts` without a segment.

**Phase 4 — End-to-end photo flow (2026-07-27).**

- **The risk reduced to one line of production code, and that is why it earned a
  browser.** The library table is 100% SSR (`src/pages/library/index.astro:223-265`)
  and nothing client-side re-fetches it, so a photo-identified row is only ever seen
  because `PhotoCapture.tsx:259-261` re-navigates to `/library` when the review dialog
  closes. Delete that statement and the row is saved, correct, and **invisible** —
  Risk #3's "never lands visibly" verbatim, with every unit, route-contract and pgTAP
  test still green. Worth noting the layer argument is stronger than "e2e is cheapest":
  `vitest.config.ts:24-25` sets `environment: "node"` and collects only `src/**/*.test.ts`,
  and the repo has no jsdom / happy-dom / testing-library — so Playwright is the **only**
  layer that can execute a React component here at all.
- **The determinism seam was a production change in a test-writing phase — the exception,
  taken once and on purpose.** Rationale, guard, and cost are written up in §7; the recipe
  is in §6.3 and `e2e/RULES.md`. The rule that generalizes: **a seam replaces the network
  hop and never the normalizers.** Stubbing past `normalizeTitleCasing` /
  `normalizePlatformLabel` would have hollowed out §6.2's normalize-before-ground
  assertions at the one layer that could still have caught the regression.
- **`webkit` declined in writing.** The fake-media launch args are Chromium-only, so a
  WebKit run of the camera spec would silently exercise the file-input path — anti-pattern
  #1 under a different name — and WebKit is not iOS Safari regardless. It would have bought
  ~1 more of `prd.md:173`'s 16 NFR cells while doubling the phase's runtime. Recorded as a
  real gap (§4), not papered over.
- **The two silent traps this phase measured**, both of which produce a *green* run that
  tests the wrong thing: omitting either fake-media launch arg (the app falls back to the
  gallery picker — guard with the enabled-Capture assertion), and a gallery fixture at or
  below **1024 px**, which sends `computeTargetDimensions` down the pass-through branch
  (`downscale.ts:32-34`) so the resize under test never runs. `e2e/fixtures/README.md`
  records the 1600×1200 requirement where the fixture lives.
- **A latent contract gap surfaced exactly where the assertion lands.** The route returns
  `entry` on the persist path (`identify.ts:192`) and the island reads it
  (`PhotoCapture.tsx:146`), but no test asserted its presence — `identify.test.ts:157,173`
  check `{status, igdbId, metadataStatus}` only. Dropping `entry` degrades the review dialog
  from `"Edit game"` to `"Add a game"` with **all 235 Vitest tests green** (measured under
  falsification). The dialog title is that gap's only observable face, and the two photo
  specs are the only things in the repo that notice.
- **Cleanup is deliberately tolerant, and asserts no row count.** F3
  (`context/archive/2026-06-17-photo-to-library/reviews/impl-review.md`) is a known,
  deferred duplication seam on the 30 s abort. Each spec deletes *every* row matching its
  timestamped title until the count is zero, rather than converting another risk's deferred
  seam into intermittent red here.
- **Island hydration is a real race for a spec that acts immediately after `goto`.** Astro
  islands ship interactive-looking SSR HTML before React attaches, so an early click is
  swallowed with no error; both specs lost that race while being written, and `seed.spec.ts`
  never does only because unrelated round-trips hydrate it first. The fix is a click retried
  while waiting on what it should reveal — a wait-for-state, not a sleep (§6.3, `e2e/RULES.md`).

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
- **The real vision-provider integration, in any automated suite** — and the
  **production-change exception** that put it here. Every prior rollout phase
  recorded code gaps rather than fixing them; Phase 4 took the exception once,
  deliberately. The seam (`stubbedVisionRead`, `src/lib/services/vision.ts`, wired
  at `identify.ts:143`) turns `POST /api/identify` deterministic for a request that
  proves knowledge of a server-side key. **Why the exception was taken:** there was
  no existing seam and none could be added from outside the app — `OPENROUTER_ENDPOINT`
  is a hardcoded const, the provider is called server-side (so `page.route()` is
  blind to it), and Playwright's `webServer.env` cannot reach the Worker because
  `.dev.vars` beats `process.env`. The alternative did not keep production untouched;
  it *transferred* the cost to the CI gate as a mandatory outbound-network +
  `OPENROUTER_API_KEY` requirement, a per-run charge, and a model-dependent
  `identified`-vs-`unsure` branch. **How it is guarded:** two independent locks (an
  optional `astro:env/server` secret must be set *and* the request must present a
  matching header), four unit cases in `src/lib/services/vision.test.ts`, and the
  entire Vitest suite running with the key `undefined` as standing evidence the
  default state is dead. It replaces **the network hop only** — the multipart
  contract, size caps, mime validation, `vision.ts`'s normalizers, grounding, the
  insert, and the SSR re-render all still run. **The acknowledged cost:** "the
  provider integration works in the real runtime" is no longer asserted anywhere
  automated; it moves to manual / pre-prod smoke (§5's optional gate). Never set
  `E2E_VISION_STUB_KEY` in a deployed environment — anyone who knows the value
  disables photo identification.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-07-27 (**Phase 4 landed**: §3 Phase 4 → complete; §4's e2e row
  re-measured against what shipped — three specs, the key-guarded vision seam, an offline provider-free
  run, and the `webkit` decline with its reason; §5's e2e gate marked due and given its CI contract
  — no outbound network, but `.dev.vars` must be written from secrets before the dev server starts.
  §6.3 filled in, §6.8 gained a Phase 4 note, §7 gained the production-change-exception bullet.
  Vitest count re-measured: **12 files / 235 tests**, green in ~2.8s). Earlier the same day: §2 Risk #3
  Source + response guidance rewritten, Risk #2's
  FR-006 citation slip corrected, and §4's e2e row de-over-claimed — all backported from
  `context/changes/testing-e2e-photo-flow/research.md`; §3 Phase 4 → researched). Prior review
  2026-07-25 (§2 Risk #5/#6 wording + guidance and §4 stack rows backported from
  `context/changes/testing-route-contracts-isolation/research.md`; §3 Phase 3 → complete, §4 Vitest +
  pgTAP rows re-measured, §5 gained the db-policy gate)
- Stack versions last verified: 2026-07-27 (Playwright 1.62.0 / bundled Chromium 151, measured)
- AI-native tool references last verified: 2026-07-18 (the pgTAP impersonation idiom in §6.7 was
  sourced from Supabase docs via Context7 `/supabase/supabase`, checked: 2026-07-25; the Playwright
  `setInputFiles`/`launchOptions` facts in §2 Risk #3 came from Context7 `/microsoft/playwright`,
  checked: 2026-07-27)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
