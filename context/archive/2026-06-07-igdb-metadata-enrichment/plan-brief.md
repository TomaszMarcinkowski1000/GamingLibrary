# IGDB Metadata Enrichment (F-02) — Plan Brief

> Full plan: `context/changes/igdb-metadata-enrichment/plan.md`
> Research: `context/changes/igdb-metadata-enrichment/research.md`
> External research: `context/changes/igdb-metadata-enrichment/external-research.md`
> Library reference: `context/changes/igdb-metadata-enrichment/library-reference.md`

## What & Why

Build a server-side lookup that, given a `title` + `platform`, returns the five required metadata fields
(genre, overall length, release year, developer, release date) plus a folded-in **series** field from IGDB,
with a graceful typed no-match result. It's a foundation (FR-008) that three slices consume — S-01 (manual
save), S-03 (photo save), and S-07 (the recommender's length/recency inputs) — so it's built once as a
reusable service rather than inlined.

## Starting Point

F-01 shipped `public.library_entries` with scalar `genre`/`developer` columns and the IGDB metadata fields.
The codebase reads secrets via `astro:env/server`, runs on Cloudflare Workers (`nodejs_compat` on), and a
recorded workerd spike already proved `@api-wrappers/igdb-wrapper` loads, instantiates, and network-calls
cleanly. No KV namespace, no `zod`, no `src/lib/services/`, and no test runner exist yet.

## Desired End State

A function `lookupGameMetadata(title, platform, kv)` in `src/lib/services/igdb.ts` returns
`{ status: "matched", ...fields } | { status: "no_match" }`. It validates input with zod, resolves the
Twitch token through a Cloudflare KV cache, runs two IGDB queries (games + length), and maps results to the
widened `library_entries` columns. A miss is a returned value, never a thrown exception.

## Key Decisions Made

| Decision           | Choice                                   | Why (1 sentence)                                                              | Source   |
| ------------------ | ---------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| Library            | `@api-wrappers/igdb-wrapper@1.0.1`       | Managed OAuth + retries + rate-limit guard; passed the workerd spike.        | Research |
| Secrets source     | `astro:env/server` (not `process.env`)   | Repo's only secret convention; Astro secrets aren't on `process.env`.        | Research |
| Schema delta       | New migration: `text`→`text[]` + `series`| F-02 amends F-01's schema by design; arrays preserve multi-value fields.      | Research |
| Token store        | **KV-cached** (namespace + fetch-wrap)   | Avoid per-isolate token churn near Twitch's 25-active-token cap.             | Plan     |
| Service surface    | **Service module only** (no API route)   | Roadmap says not user-facing; consumers are server-side slices.              | Plan     |
| Input validation   | **Add zod**                              | Establish the CLAUDE.md convention from the foundation, reusable by S-01.    | Plan     |
| No-match semantics | **Zero-results = `no_match`**, typed     | Deterministic, right altitude; edition disambiguation deferred.             | Plan     |
| Testing            | **Typecheck/lint/build + manual harness**| No test runner at the foundation stage; live-API path is what matters.       | Plan     |

## Scope

**In scope:** new migration + type regen; Twitch secrets in env schema; install wrapper + zod; KV namespace +
binding + `runtime.env` typing; KV token-cache fetch wrapper; per-request client factory; the lookup service
(zod input, platform resolution, two queries, field mapping, typed no-match); live verification.

**Out of scope:** any API route; low-confidence/edition disambiguation; a test runner; Franchise field; changes
to how platforms are entered; observability; production KV/secret provisioning (deploy-time follow-up).

## Architecture / Approach

A per-request `IGDBClient` factory (KV is request-scoped, so no module-level singleton) reads Twitch creds from
`astro:env/server` and is wired with a wrapped `fetch` that short-circuits the `id.twitch.tv/oauth2/token` POST
against KV. `lookupGameMetadata` validates input, resolves the platform string to IGDB platform id(s) via a
static map (unfiltered fallback when unknown), runs the `games` search + `game_time_to_beats` length query, and
maps both into the discriminated result DTO.

## Phases at a Glance

| Phase                                          | What it delivers                                          | Key risk                                              |
| ---------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| 1. Schema migration + types                    | Widened columns + `series`; regen types; result DTO      | `text`→`text[]` conversion; type drift                |
| 2. Config, deps & KV infrastructure            | Secrets, wrapper+zod, KV namespace/binding, runtime types| KV is a brand-new pattern for this codebase           |
| 3. KV token-cache wrapper + client factory     | Fetch-wrapping token cache; per-request client factory   | Trickiest custom code; synthetic token response shape |
| 4. Lookup service                              | zod input, platform resolution, queries, field mapping   | Platform resolution; correct field mapping            |
| 5. Live verification & harness cleanup         | End-to-end check vs real IGDB; remove harness            | Requires live Twitch creds (user action item)         |

**Prerequisites:** Phases 1–4 need none beyond the repo; Phase 5 needs live `TWITCH_CLIENT_ID`/`SECRET`.
**Estimated effort:** ~2–3 sessions across 5 phases; the KV token-cache (Phase 3) is the main unknown.

## Open Risks & Assumptions

- KV + `locals.runtime.env` is a pattern used nowhere in the codebase today — Phase 2/3 introduce it from scratch.
- The wrapper has no token-provider hook, so KV reuse depends on the `fetch`-wrapping interception working as
  documented (`library-reference.md §5`).
- IGDB length coverage is sparse — `length_hours` is nullable by design; S-07 absorbs the gap.
- Platform matching is fuzzy; a confident-but-wrong match still returns `matched` (disambiguation deferred).

## Success Criteria (Summary)

- A known title+platform returns a populated `matched` result with all available fields correctly mapped.
- A nonsense title returns `{ status: "no_match" }` without throwing.
- The Twitch token is served from KV on repeat calls (no per-isolate re-mint), and all of typecheck/lint/build
  plus the migration apply cleanly.
