# API Route Contracts + Cross-User Isolation — Plan Brief

> Full plan: `context/changes/testing-route-contracts-isolation/plan.md`
> Research: `context/changes/testing-route-contracts-isolation/research.md`

## What & Why

Rollout Phase 3 of the test plan: prove the database enforces per-user ownership
(Risk #5) and that the add/edit input boundaries hold (Risk #6). Research inverted
the test plan's guidance for **both** risks in opposite directions — the route
deliberately does not enforce ownership (RLS is the sole gate, ratified), and two of
Risk #6's three named probes describe behaviour that is either inverted or was
deliberately never built. This plan is built on the corrected reading.

## Starting Point

172 tests green across 9 files. A route-test harness and a fetch-edge mock exist
from Phase 1. What does not exist: any test for `src/pages/api/library/**`, any test
for `patchEntrySchema` / `createEntrySchema` / `listAllEntries` /
`getRecommendations`, and **any database-policy test at all** — `supabase/tests/`
is not there, and pgTAP 1.3.3 is available but not installed. Isolation has been
verified exactly once, manually, in June 2026.

## Desired End State

A pgTAP suite proves that as user B, writes against user A's rows leave A's data
provably unchanged, reads return none, both facet RPCs return only B's values, a
foreign-`user_id` insert is refused, and the `anon` role sees nothing. The library
routes have contract tests that pin status codes and outgoing calls — explicitly
labelled as proving *translation*, not ownership. The three genuine
validation divergences are recorded as documentation-of-behaviour, with the FR-010
violation flagged for a follow-up change.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Layer for Risk #5 | pgTAP under `supabase/tests/database/` | A stubbed client passes identically against a database with RLS disabled — it reads as coverage while proving nothing. | Research |
| pgTAP user fixture | `insert into auth.users` inside the rolled-back transaction | Self-contained and re-runnable; no seed file, no gotrue, no residue in the dev database (verified: only `id` + `email` needed). | Plan |
| pgTAP extension | Created in-test, rolled back | A test-writing phase ships no production schema change — a migration would push pgTAP into the deployed database. | Plan |
| Gating | `npm run test:db` + docs, no CI | §5 assigns gate wiring to Phase 5, and CI has no `npm test` step yet to sit beside. | Plan |
| POST `/api/library` scope | Guards + 400s + one 201 via the fetch router | `createEntrySchema` is unexported, so the route is the only layer that reaches it — and the captured insert payload is the only place the platform asymmetry is observable. | Plan |
| Three code gaps | Recorded, not fixed; decimal flagged for follow-up | Holds the Phase 1/2 no-behaviour-change line without burying a must-have FR violation. | Plan |
| Guard-order 500-vs-401 | Assert both faces, each labelled | Without the client mock a 401 assertion is *vacuous* — the env stub leaves `SUPABASE_*` undefined on purpose. | Research + Plan |
| Recommender carry-over | In scope, column **containment** derived from the engine | Closes a hole Phase 2 named in-file; asserting `RECOMMENDATION_MAX_ROWS` would be the mirror anti-pattern. | Plan |
| Mutation pass | Yes — two files, Vitest layer only | Matches the phase close-out precedent, but cannot touch pgTAP, so the plan says so rather than implying phase-wide hardening. | Plan |

## Scope

**In scope:** pgTAP isolation suite + `test:db` script; `patchEntrySchema` /
`updateEntrySchema` gaps; `[id].ts` and `index.ts` route contracts; shared
`test/helpers/supabase-mock.ts`; `listAllEntries` / `getRecommendations`; a Stryker
pass on two files; §6 cookbook (§6.4 + a new pgTAP section).

**Out of scope:** any production behaviour change (three gaps recorded); reordering
the config/auth guards; CI wiring (Phase 5); a second vitest project or Docker in
`npm test`; Miniflare and the Astro Container API; component tests and `.tsx`
mutation; extracting `library/index.astro` frontmatter; per-filter-dimension
isolation assertions; auth internals (§7).

## Architecture / Approach

Two layers covering **disjoint** failure sets. pgTAP exercises real Postgres with
two impersonated users and carries Risk #5 alone. Hermetic Vitest — direct handler
invocation with a cast `APIContext`, Supabase stubbed, IGDB mocked at the fetch
edge — carries every route contract and all of Risk #6. Neither substitutes for the
other, and the route suite says so in its own header so its 404 tests are never
mistaken for isolation coverage.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. pgTAP isolation | The only possible defense of Risk #5 | A silently-failed impersonation makes every assertion pass vacuously |
| 2. Validation schemas | `patchEntrySchema` + the uncovered fields | Asserting at a layer that cannot see the bug it names |
| 3. `[id].ts` contracts | 404/204/guard translation + shared mock helper | Reading as isolation coverage when it proves none |
| 4. POST `/api/library` | `createEntrySchema` + the platform behaviour record | Asserting an unbuilt feature (manual-path normalization) |
| 5. Recommender boundary | `listAllEntries` / `getRecommendations` | Mirroring `RECOMMENDATION_COLUMNS` instead of deriving it |
| 6. Stryker + §6 cookbook | Hardening and the written-down patterns | Implying phase-wide hardening Stryker cannot deliver |

**Prerequisites:** Docker + local Supabase stack up (`npx supabase start`) for
Phase 1 and Phase 6's re-check. Everything else runs offline.
**Estimated effort:** ~2–3 sessions across six sub-phases; Phase 1 and Phase 4 are
the two with real setup cost.

## Open Risks & Assumptions

- The pgTAP suite's value depends entirely on its positive control and its
  effect-based (not `returning`-based) assertions. Get either wrong and it is a
  decorative green check over the project's single point of failure.
- The `auth.users` fixture couples to gotrue's schema. Verified against the live
  database today; a future gotrue change would break it loudly, not silently.
- The isolation suite is on the honour system until Phase 5 wires CI.
- No database test can catch a `SUPABASE_KEY` swapped for the service key — that
  stays a deployment concern (`deployment-plan.md:107` already flags it).
- The FR-010 decimal violation remains live until a follow-up change picks it up.

## Success Criteria (Summary)

- A second user cannot read, modify or delete another user's library entry — and
  that claim is now backed by an executable test against real Postgres, not by a
  one-off manual check from June.
- A malformed or out-of-range edit gets a clear 400 where the contract promises one,
  and the places where it does not are written down as decisions rather than
  discovered as surprises.
- The next contributor can write a route test or a policy test from §6 alone.
