# Grounding & identify-seam integration tests — Plan Brief

> Full plan: `context/changes/testing-grounding-identify-seam/plan.md`
> Research: `context/changes/testing-grounding-identify-seam/research.md`

## What & Why

Write the first tests defending the photo → identify → auto-save path (Risks #1 and #2 of the
test plan). The path today has **zero coverage** on its two riskiest surfaces: IGDB grounding
correctness (does it attach the right game/edition, or abstain?) and the identify orchestration
(do the two abstain faces stay distinct, does normalization run before grounding, does the error
path leak provider keys?). A wrong auto-save is silently trusted, so this is where the killer
feature can fail invisibly.

## Starting Point

`/api/identify` has no tests at all. `igdb.test.ts` covers the pure collapse/confidence helpers
but never drives `lookupGameMetadata` and mocks no HTTP. The test harness is missing an
`OPENROUTER_API_KEY` and truthy Twitch creds needed to exercise the real code paths, and the
S-09 shelf fixture the test plan named is gitignored — it doesn't exist in-repo.

## Desired End State

`npm test` runs a green suite with two new files: a grounding-wiring integration suite
(`lookupGameMetadata` over a mocked fetch edge against authored base-game fixtures) and a route
seam suite (the full `/api/identify` contract). The test-plan cookbook (§6.2) documents the
recipe, and Phase 1 of the rollout reads `complete`. No production behavior changes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Test layer | Hermetic integration | Mock OpenRouter/IGDB at `globalThis.fetch`, stub Supabase insert; never mock internal grounding or vision normalizers — those are the seam. | Research |
| Oracle for grounding | Authored `Game` fixtures | The S-09 sample is gitignored; base-game truth must be hand-built, not read from disk or from IGDB's output. | Research |
| Abstain-asymmetry framing | Assert the two faces stay **distinct** | Vision `unsure` → no save; confident + IGDB `no_match` → saved with `no_match` (by design) — the naive "no_match → manual" test would mirror a misread requirement. | Research (corrects test-plan) |
| Empty-title gap | Record as known gap, no test | A test would either mirror a probable bug or require a production change — out of scope for a test-writing phase. | Plan |
| Ambiguity gap | Record as known gap, no test | Multiple-close-hits disambiguation is unimplemented; a test would pretend to cover an absent feature. | Plan |
| GET leak residual | One assertion now | Cheap; closes the one residual key-leak surface and satisfies Risk #2's no-leak challenge. | Plan |
| Mutation rigor | Boundary fixtures, no Stryker run | Kills the 0.34/0.8/5 constant mutants via explicit boundary tests; Stryker stays selective/ad-hoc. | Plan |
| Route seam breadth | Full identify contract | Phase 1 builds the identify harness anyway; Phase 3's cross-user focus won't revisit it. | Plan |

## Scope

**In scope:** env-stub extension + shared fetch-router helper; `lookupGameMetadata` grounding
tests (edition-collapse, remake platform-agreement, metadata-off-the-base, `no_match` faces,
boundary constants); `/api/identify` route tests (abstain asymmetry, normalize-before-ground,
auth/upload/502, harness fold, GET no-leak); test-plan cookbook + status sync.

**Out of scope:** fixing the empty-title or ambiguity gaps; running Stryker; cross-user isolation
and library routes (Phase 3); CI gate wiring (Phase 5); e2e/browser (Phase 4); testing the live
IGDB/OpenRouter APIs or Supabase auth internals.

## Architecture / Approach

Bottom-up. Phase 1 stands up one mock edge (`globalThis.fetch` router + extended env stub) both
suites reuse. Phase 2 drives `lookupGameMetadata` through it against authored `Game` fixtures —
the real wrapper query serialization runs, only the network is faked. Phase 3 constructs an
`APIContext` (multipart request, `locals.user`, cookies) and injects a capturing Supabase stub by
mocking `@/lib/supabase`, while OpenRouter/IGDB fetch stay mocked and `vision.ts` runs for real.
Phase 4 is docs/sync.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness setup | Extended env stub + shared fetch-router helper | Env-stub change regresses existing suites (mitigated: they mock `./igdb` or use pure helpers) |
| 2. Grounding wiring | `lookupGameMetadata` integration tests + boundary fixtures | Fetch router must answer the Twitch token mint or the IGDB client's auth fails first |
| 3. Route seam | Full `/api/identify` contract tests | Asserting on row *presence* instead of *shape* would pass against an un-grounded guess |
| 4. Cookbook + sync | Filled §6.2/§6.6, status → complete, gaps recorded | Low — docs only |

**Prerequisites:** none beyond the existing Vitest setup; no live creds (all providers mocked).
**Estimated effort:** ~2–3 sessions across 4 phases (Phase 1 small, Phases 2–3 the bulk, Phase 4 trivial).

## Open Risks & Assumptions

- Assumes the `@api-wrappers/igdb-wrapper` calls `api.igdb.com/v4/games` / `/v4/game_time_to_beats`
  and mints the Twitch token via `id.twitch.tv/oauth2/token` — the fetch router keys on these
  substrings; verify the exact URLs when wiring Phase 2.
- The two recorded gaps (empty-title, ambiguity) remain live in production until a future change
  picks them up; this phase only makes them discoverable.

## Success Criteria (Summary)

- `npm test` green: `lookupGameMetadata` proves edition-collapse to the base id, remake
  platform-agreement, and `no_match` on thin/weak reads — asserted against base-game truth.
- The `/api/identify` suite proves the two abstain faces stay distinct, normalization shows up in
  the saved values, and the error paths surface clean failures without leaking provider keys.
- Every assertion traces to an oracle (FR/PRD/domain rule or authored truth), never to the code
  under test.
