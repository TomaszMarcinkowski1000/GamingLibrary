# Grounding & identify-seam integration tests (test-plan Phase 1) Implementation Plan

## Overview

Write the first tests defending the photo → identify → auto-save path (Risks #1 and #2
of `context/foundation/test-plan.md`). The tests prove the path **cannot silently save the
wrong game or the wrong edition's metadata**, and that its two deliberate abstain faces
(vision `unsure` → manual entry, no save; confident vision + IGDB `no_match` → saved with
`metadata_status='no_match'`) never collapse into each other.

The layer is **hermetic integration**: mock OpenRouter and IGDB at the `globalThis.fetch`
network edge, stub the Supabase insert chain, and **never mock** the internal grounding
(`lookupGameMetadata` / `isConfidentMatch` / `collapseToBaseGame`) or the `vision.ts`
normalizers — those are the seam under test. This phase writes tests only; it makes **no
production behavior changes**. Two real code gaps surfaced during research (empty-title
pass-through, missing ambiguity disambiguation) are recorded as known gaps, not fixed here.

## Current State Analysis

- **`/api/identify` has zero tests.** The entire orchestration — auth gate, upload
  validation, vision → normalize → ground → route/save wiring, the persist-vs-harness
  split, the 502 mapping, secret non-leakage — is untested (`src/pages/api/identify.ts`).
- **`lookupGameMetadata` wiring is untested.** `src/lib/services/igdb.test.ts` is a solid
  pure-unit suite over hand-built `Game` fixtures for `collapseToBaseGame` and
  `isConfidentMatch`, but it never invokes `lookupGameMetadata` and mocks no HTTP. The
  fetch → collapse → confidence → field-map wiring (`igdb.ts:499-561`) and the
  "metadata read off the collapsed base, not the edition" property (`igdb.ts:329` leak
  surface) have no coverage. The boundary constants (0.34 / 0.8 / 5) are only implicitly
  exercised — mutation-survivable.
- **The test harness lacks two things a live-path test needs.**
  `test/stubs/astro-env-server.ts` (aliased in `vitest.config.ts:15`) exports `SUPABASE_*`
  and `TWITCH_*` as `undefined` and **has no `OPENROUTER_API_KEY`**. `createIgdbClient`
  (`igdb.ts:25`) throws if `TWITCH_CLIENT_ID/SECRET` are falsy; `identifyGameFromPhoto`
  (`vision.ts:80`) throws if `OPENROUTER_API_KEY` is falsy. Both must be truthy for the
  real code paths to run under test.
- **The fetch edge is `globalThis.fetch`.** `igdb.ts` never calls `fetch` directly — HTTP
  is owned by `@api-wrappers/igdb-wrapper`, wired through `createTokenCachingFetch(kv)`
  (`igdb.ts:34`), which passes everything except the Twitch token URL straight to
  `globalThis.fetch` (`igdb-token-cache.ts:57-59`). So mocking `globalThis.fetch` exercises
  the **real wrapper query serialization** and is the correct edge for `lookupGameMetadata`.
- **The S-09 shelf fixture does not exist in-repo.** `fixtures/shelf/` commits only
  `README.md` + `labels.example.csv`; the photos and `labels.csv` are gitignored. The oracle
  must be **authored** as hand-built `Game`-shaped fixtures encoding base-game truth.
- **Reusable stub shape exists.** `library.test.ts:23-35` (`insertClient()`) is a ready
  Supabase `.insert().select().single()` stub that captures the insert payload.

## Desired End State

`npm test` runs a green suite that includes:

1. `src/lib/services/igdb.integration.test.ts` — `lookupGameMetadata` driven through a mocked
   `globalThis.fetch`, asserting edition-collapse to the base id, remake platform-agreement,
   metadata-off-the-base, `no_match` on thin/weak/disjoint reads, and the boundary constants.
2. `src/pages/api/identify.test.ts` — the full `/api/identify` contract: the two abstain
   faces stay distinct, normalize-before-ground holds on the saved values, auth/upload/502
   boundaries, the harness-path fold, and the GET no-leak assertion.
3. An extended env stub + a shared fetch-routing test helper both suites reuse.
4. Test-plan §6.2 and §6.6 filled in; §3 Phase 1 status flipped to `complete`; `change.md`
   status `complete`; the two known code gaps recorded in this plan's "NOT doing".

Verify: `npm test` green, `npm run lint` clean, `npx astro check` clean, and each assertion
traces to an oracle (PRD/FR/domain rule or authored base-game truth), never to the code under
test.

### Key Discoveries:

- **The abstain asymmetry is the whole point of the phase** (`identify.ts:163-166` verbatim
  comment; `photo-to-library/plan.md:56`). Vision `unsure` → `{status:"unsure"}`, insert
  **never called** (`identify.ts:150-152`) — the FR-006/US-01 manual-entry line. Confident
  vision + IGDB `no_match`/`null` → **still inserts** `igdb_id=null, metadata_status='no_match'`
  (`identify.ts:167-194`) — correct by design. A test asserting "IGDB no_match → route to
  manual" would be a mirror of a misread requirement. The protective assertion is that the two
  faces stay distinct, and that success is asserted on `metadata_status`/`igdb_id`, **not row
  presence** (a confident ground-miss also writes a row).
- **Normalization is cosmetic to the matched id but load-bearing for the saved value**
  (`vision.ts:137-138` choke point; `igdb.ts` re-normalizes internally). So a
  normalize-before-ground test must assert the **saved/displayed** title+platform and must
  **not mock the vision module** (mocking it skips the normalizers, making the assertion hollow).
- **Metadata reads off the collapsed base** (`igdb.ts:509,551-561`). The edition's metadata
  leaks whenever `collapseToBaseGame` returns the top candidate unchanged while that top is
  itself an edition entry (the two `return { base: top }` branches at `igdb.ts:329`). This is
  the precise "attaches the wrong edition metadata" surface to guard.
- **Mocking `globalThis.fetch` intercepts both the Twitch OAuth token POST and the IGDB
  query.** The helper must route by URL: `id.twitch.tv/oauth2/token` → a fake token,
  `api.igdb.com/v4/games` → candidates, `game_time_to_beats` → length, `openrouter.ai` → the
  vision envelope.

## What We're NOT Doing

- **Not fixing the empty-title gap.** `vision.ts:32-36` uses `z.string()` (no `.min(1)`), so a
  high-confidence empty title passes as `identified` and is auto-saved. Recorded as a **known
  gap** for a future change; Phase 1 writes no test for it (a test would either mirror a
  probable bug or require a production behavior change, both out of scope for a test-writing
  phase).
- **Not building ambiguity disambiguation.** `isConfidentMatch` compares only the single
  resolved base against the query — there is **no multiple-close-hits detection**
  (`igdb.ts:314` trusts candidate[0]). "Genuine ambiguity ⇒ abstain" is **unimplemented**;
  recorded as a known gap, no test (a test would pretend coverage of an absent feature).
- **Not running Stryker this phase.** Boundary fixtures at the `isConfidentMatch` constants are
  added, but no mutation-testing gate is stood up (Stryker stays a selective, ad-hoc tool).
- **Not testing the IGDB live API, OpenRouter live API, or Supabase auth internals**
  (test-plan §7 exclusions).
- **Not covering cross-user isolation or the library routes** — that is test-plan Phase 3.
- **Not wiring the CI test gate** — that is test-plan Phase 5.
- **Not adding an e2e / browser test** — that is test-plan Phase 4.

## Implementation Approach

Build bottom-up: stand up the shared harness (env stub + fetch router) first so both test
suites have a stable mock edge; then the `lookupGameMetadata` grounding suite (the id-correctness
core of Risk #1); then the `/api/identify` route suite (the orchestration/abstain core of Risk
#2, which reuses the same fetch router plus a stubbed Supabase client); finally the docs/sync.

Phases 2 and 3 are TDD-able (each assertion names an observable outcome before any test code) —
either `/10x-implement` or `/10x-tdd` fits. Phase 1 is scaffolding (no red test precedes it) and
Phase 4 is docs — both are `/10x-implement`.

## Critical Implementation Details

- **Env-stub blast radius.** Making `TWITCH_CLIENT_ID/SECRET` and `OPENROUTER_API_KEY` truthy in
  the shared stub is safe: the existing suites either mock `./igdb` wholesale (`library.test.ts:6`)
  or exercise only pure helpers that never read these values, and no existing test hits a live
  fetch path. Leave `SUPABASE_URL/KEY` as `undefined` — the route persist test injects its Supabase
  client by mocking `@/lib/supabase`'s `createClient`, so the real one is never constructed.
- **Fetch-router ordering.** The Twitch token URL check in `createTokenCachingFetch` is a
  substring match (`igdb-token-cache.ts:57`), and it calls `globalThis.fetch` for the *real* token
  mint on a cache miss. With an empty/stub KV the cache always misses, so the router **must** answer
  the `id.twitch.tv/oauth2/token` POST with a valid `{access_token, expires_in, token_type}` body
  or `createIgdbClient`'s auth flow fails before the games query runs.
- **Assert on shape, not presence, for the save faces.** Because a confident vision read that
  ground-misses also writes a row, any "a row exists" assertion passes against an un-grounded
  guess. Route-save assertions read the captured insert payload's `metadata_status` / `igdb_id`
  (the `insertClient()` `payload()` capture), never mere insert invocation.

## Phase 1: Test harness setup

### Overview

Extend the env stub and add a shared `globalThis.fetch` routing helper so the grounding and
route suites have one mock edge. No behavior asserted yet — this is scaffolding the later phases
consume.

### Changes Required:

#### 1. Extend the test env stub

**File**: `test/stubs/astro-env-server.ts`

**Intent**: Provide truthy provider credentials so `createIgdbClient` and `identifyGameFromPhoto`
run their real code paths under test instead of throwing on a missing secret. Add
`OPENROUTER_API_KEY` (absent today) and give `TWITCH_CLIENT_ID/SECRET` non-empty test values.
Leave `SUPABASE_*` undefined.

**Contract**: Adds `export const OPENROUTER_API_KEY: string | undefined = "test-openrouter-key"`;
changes `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET` to non-empty strings. Comment explains these are
dummy values for the mocked fetch edge, never live creds.

#### 2. Shared fetch-routing test helper

**File**: `test/helpers/fetch-mock.ts` (new)

**Intent**: One reusable helper that installs a `globalThis.fetch` spy routing requests by URL to
caller-supplied responses, so Phase 2 (IGDB) and Phase 3 (IGDB + OpenRouter) don't each re-implement
URL routing. Must answer the Twitch token endpoint by default (every IGDB call triggers it) and let
tests register per-URL response bodies for the IGDB `games`, `game_time_to_beats`, and OpenRouter
endpoints.

**Contract**: Exports an installer (e.g. `installFetchRouter(routes)`) returning a teardown, plus a
default Twitch-token responder returning `{ access_token, expires_in, token_type }`. Routing keys are
URL substrings (`id.twitch.tv/oauth2/token`, `/v4/games`, `/v4/game_time_to_beats`,
`openrouter.ai`). Unmatched URLs throw a loud "unexpected fetch" so a missing stub fails visibly
rather than hitting the network. Restores the original `fetch` on teardown (`afterEach`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Existing suite still green (no regression from the stub change): `npm test`

#### Manual Verification:

- The fetch helper's "unexpected fetch" guard visibly fails a test when a URL is unstubbed
  (confirm by temporarily removing a route).

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 2: `lookupGameMetadata` grounding wiring tests

### Overview

Drive `lookupGameMetadata` end-to-end through the mocked fetch edge against authored `Game`-shaped
oracle fixtures, asserting id-correctness and abstain behavior — the core of Risk #1. Never mock
`collapseToBaseGame` / `isConfidentMatch` / the wrapper query builder.

### Changes Required:

#### 1. Authored oracle fixtures

**File**: `src/lib/services/igdb.integration.test.ts` (new; fixtures co-located or in a sibling
`__fixtures__` module)

**Intent**: Encode base-game truth as hand-built `Game`-shaped objects (mirroring `igdb.test.ts`),
covering the documented edition-collapse and remake cases — independent of IGDB's current output.

**Contract**: `Game`-shaped fixtures for: an edition-variant hit whose base is a sibling/relation
(e.g. *Alan Wake II Deluxe Edition* → base *Alan Wake II*, boxed platform retained); a remake case
where `parent_game` links the current-gen entry to the older original (Dead Space 2023 / Super
Mario RPG / OoT 3D — the base platform excludes the boxed console, so the relation is skipped and
the platform-correct entry is kept); a thin-term case (`"e"`); a weak/obscure name below
`NAME_SIM_FLOOR`; a disjoint-platform case; an empty candidate list; and boundary fixtures sitting
exactly at / just below `NAME_SIM_FLOOR` (0.34), `NAME_SIM_STRONG` (0.8), and `POP_FLOOR` (5).

#### 2. `lookupGameMetadata` wiring assertions

**File**: `src/lib/services/igdb.integration.test.ts`

**Intent**: Assert the fetch → collapse → confidence → field-map wiring produces the base-game
truth, including the "metadata read off the base, not the edition" property that guards the
`igdb.ts:329` leak.

**Contract**: Tests install the fetch router (Twitch token + `/v4/games` returning the fixture
candidates + `/v4/game_time_to_beats` returning a length), call
`lookupGameMetadata(title, platform, stubKv)`, and assert:
- edition variant → `status:"matched"`, `igdbId` = the **base** id, `collapsedFrom` = the edition id;
- remake → `igdbId` = the platform-correct entry, **not** the older original;
- returned `genre`/`developer`/`series`/`releaseYear` read off the collapsed base, not the edition;
- thin / weak / disjoint / empty-candidate → `status:"no_match"`;
- each boundary fixture lands on the correct side of its constant (at-floor matches, just-below
  abstains) — the assertions that kill the constant mutants.

`stubKv` is a minimal `KVNamespace` stub (`{}`-shaped as in `library.test.ts:20`), forcing a token
cache miss so the router answers the mint.

### Success Criteria:

#### Automated Verification:

- New grounding suite passes: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- Spot-check one assertion by flipping a boundary constant in `igdb.ts` locally and confirming the
  matching boundary test fails (mutation sanity — revert after).
- Confirm no test references `fixtures/shelf/` on disk and no assertion copies a value produced by
  `igdb.ts` itself.

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 3: `/api/identify` route seam tests

### Overview

Exercise the full `/api/identify` contract through a constructed `APIContext`, with OpenRouter and
IGDB mocked at the fetch edge and Supabase injected as a capturing stub — the core of Risk #2. The
vision module and internal grounding are **not** mocked.

### Changes Required:

#### 1. Route test harness wiring

**File**: `src/pages/api/identify.test.ts` (new)

**Intent**: Stand up the machinery to invoke the route: a `multipart/form-data` `Request` builder
(a `photo` `File`, optional `persist="true"`), a truthy `locals.user`, `cookies`, and a Supabase
insert stub injected by mocking `@/lib/supabase`'s `createClient`.

**Contract**: Reuses the `installFetchRouter` helper and the `insertClient()` capture shape
(`library.test.ts:23-35`). `vi.mock("@/lib/supabase", () => ({ createClient: () => stubClient }))`
returns the capturing stub so the persist path never needs `SUPABASE_*` env. Helper builds a valid
image `File` (accepted mime, non-empty, under 10 MB) for the happy paths and malformed variants for
the 400 cases.

#### 2. Abstain-asymmetry and save-shape assertions (the phase's core)

**File**: `src/pages/api/identify.test.ts`

**Intent**: Prove the two abstain faces stay distinct and that a saved row is asserted on shape,
not presence.

**Contract**: With OpenRouter stubbed to return a vision envelope and IGDB stubbed per case:
- vision `unsure` (confidence < 0.6 or unparseable envelope) → response `{status:"unsure"}`, and the
  Supabase insert stub was **never called** (manual-entry face; FR-006/US-01);
- confident vision + IGDB `no_match`/`null`, `persist=true` → response `status:"identified"` with
  `igdbId:null`, and the **captured insert payload** has `metadata_status:"no_match"`, `igdb_id:null`
  (by-design save face — assert payload shape, not that insert ran);
- confident vision + IGDB matched, `persist=true` → captured payload `metadata_status:"matched"`,
  `igdb_id` = base id;
- harness path (`persist` off) + IGDB `no_match` → response folds to `{status:"unsure"}`
  (the inverted, non-persist behavior).

#### 3. Normalize-before-ground assertion

**File**: `src/pages/api/identify.test.ts`

**Intent**: Prove normalization runs before grounding **and** shows up in the saved values, with the
real `vision.ts` normalizers in the path.

**Contract**: OpenRouter stub returns a raw shouty/aliased read (e.g. lowercase title + platform
alias like `"ps5"`); the IGDB `/v4/games` route asserts the **request body** carries the normalized
title/platform; the captured Supabase payload's `title`/`platform` are the normalized forms. The
`vision` module is **not** mocked (mocking it would skip the normalizers).

#### 4. Boundary, error, and no-leak assertions

**File**: `src/pages/api/identify.test.ts`

**Intent**: Cover the rest of identify's own route contract and the residual GET leak surface.

**Contract**:
- no `locals.user` → 401 (GET and POST);
- upload 400s: missing `photo`, empty file, oversized (> 10 MB), non-image mime;
- OpenRouter non-2xx → 502 with a status-only message (no upstream body leaked);
- GET path with IGDB stubbed to throw an error whose message embeds a Twitch-token-like string →
  502 body contains **neither** the Twitch secret **nor** a bearer token (the residual-leak guard).

### Success Criteria:

#### Automated Verification:

- New route suite passes: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- Confirm the persist-save assertions read the captured payload (`metadata_status`/`igdb_id`), not
  merely that insert was invoked.
- Confirm the normalize test does not mock `@/lib/services/vision` and the vision module is exercised
  for real.

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 4: Cookbook and plan sync

### Overview

Fill in the test-plan cookbook for the integration layer, record the two known gaps, and advance the
rollout status.

### Changes Required:

#### 1. Fill the integration-test cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.2 "TBD" with the concrete recipe this phase established, and add a §6.6
per-phase note capturing what was surprising.

**Contract**: §6.2 documents: location/naming for grounding vs route integration tests, the
`globalThis.fetch` routing edge (Twitch token + IGDB + OpenRouter), the `insertClient()` Supabase
stub, the env-stub requirement, and the two hard rules (never mock internal grounding; never mock the
vision normalizers). §6.6 notes the abstain-asymmetry oracle correction and the assert-on-shape rule.

#### 2. Record the known gaps and advance status

**File**: `context/foundation/test-plan.md`, `context/changes/testing-grounding-identify-seam/change.md`

**Intent**: Make the two unimplemented gaps discoverable, and move Phase 1 to `complete`.

**Contract**: Note the empty-title and ambiguity gaps in the test-plan (a short line near §7 or §6.6
pointing to this plan's "NOT doing"). Flip test-plan §3 Phase 1 Status → `complete`. Set `change.md`
`status: complete`, `updated:` today.

### Success Criteria:

#### Automated Verification:

- Full suite green: `npm test`
- Linting/format on docs: `npm run lint`

#### Manual Verification:

- test-plan §6.2 reads as a recipe a future contributor can follow without re-deriving the mock edge.
- §3 Phase 1 status and `change.md` status both read `complete`.

**Implementation Note**: This phase is docs/sync; no manual product testing required beyond a read
of the updated test-plan.

---

## Testing Strategy

### Unit Tests:

- Boundary fixtures at the `isConfidentMatch` constants (0.34 / 0.8 / 5) — one assertion each side
  of each threshold, to kill constant mutants (Phase 2). These extend, not duplicate, the existing
  pure `igdb.test.ts`.

### Integration Tests:

- `lookupGameMetadata` end-to-end over mocked `globalThis.fetch` against authored `Game` fixtures
  (Phase 2): edition-collapse, remake platform-agreement, metadata-off-the-base, `no_match` faces.
- `/api/identify` end-to-end over a constructed `APIContext` with mocked provider fetch + stubbed
  Supabase insert (Phase 3): abstain asymmetry, normalize-before-ground, auth/upload/502 boundaries,
  harness fold, GET no-leak.

### Manual Testing Steps:

1. Run `npm test` — confirm all suites (existing 6 + the two new files) are green.
2. Temporarily flip one `isConfidentMatch` constant in `igdb.ts` and confirm the matching boundary
   test fails; revert.
3. Grep the new tests for `fixtures/shelf` and for values copied out of `igdb.ts` — confirm none.

## Migration Notes

None — additive test files, one env-stub extension, and doc updates. No schema, API, or runtime
behavior changes.

## References

- Research: `context/changes/testing-grounding-identify-seam/research.md`
- Test plan (risk map, strategy, cookbook): `context/foundation/test-plan.md`
- Lessons (platform-aware collapse rule): `context/foundation/lessons.md:12-17`
- Route under test: `src/pages/api/identify.ts:117-213` (POST), `:89-115` (GET)
- Grounding under test: `src/lib/services/igdb.ts:437` (`lookupGameMetadata`), `:314-330`
  (`collapseToBaseGame`), `:403-424` (`isConfidentMatch`)
- Vision normalizers: `src/lib/services/vision.ts:137-138`
- Reusable stub shape: `src/lib/services/library.test.ts:23-35`
- Fixture pattern to mirror: `src/lib/services/igdb.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Test harness setup

#### Automated

- [x] 1.1 Type checking passes: `npx astro check`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Existing suite still green: `npm test`

#### Manual

- [x] 1.4 Fetch helper's "unexpected fetch" guard visibly fails a test when a URL is unstubbed

### Phase 2: `lookupGameMetadata` grounding wiring tests

#### Automated

- [ ] 2.1 New grounding suite passes: `npm test`
- [ ] 2.2 Type checking passes: `npx astro check`
- [ ] 2.3 Linting passes: `npm run lint`

#### Manual

- [ ] 2.4 Flip a boundary constant locally and confirm the matching boundary test fails (revert)
- [ ] 2.5 Confirm no test reads `fixtures/shelf/` and no assertion copies a value from `igdb.ts`

### Phase 3: `/api/identify` route seam tests

#### Automated

- [ ] 3.1 New route suite passes: `npm test`
- [ ] 3.2 Type checking passes: `npx astro check`
- [ ] 3.3 Linting passes: `npm run lint`

#### Manual

- [ ] 3.4 Confirm persist-save assertions read the captured payload, not merely that insert ran
- [ ] 3.5 Confirm the normalize test does not mock `@/lib/services/vision`

### Phase 4: Cookbook and plan sync

#### Automated

- [ ] 4.1 Full suite green: `npm test`
- [ ] 4.2 Linting/format on docs: `npm run lint`

#### Manual

- [ ] 4.3 test-plan §6.2 reads as a followable recipe
- [ ] 4.4 §3 Phase 1 status and `change.md` status both read `complete`
