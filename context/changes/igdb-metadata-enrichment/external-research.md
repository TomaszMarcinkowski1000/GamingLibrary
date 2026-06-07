---
change_id: igdb-metadata-enrichment
kind: external-research
created: 2026-06-07
sources: exa.ai (IGDB API docs, igdbapi.proto, Twitch dev docs, library repos)
---

# IGDB metadata enrichment — external research

External research backing the lookup contract for F-02. Answers: which library, which
fields back the required metadata (genre, overall length, release year, developer,
release date, **series**), and what limitations constrain the design.

## How IGDB works (the constraints that shape everything)

- IGDB has **no standalone auth** — it rides on **Twitch OAuth**. Register a *Confidential*
  app in the Twitch Developer Portal, run the `client_credentials` flow against
  `https://id.twitch.tv/oauth2/token`, and send `Client-ID` + `Authorization: Bearer <token>`
  on every request.
- **Backend-only.** IGDB does **not** support CORS/browser requests (it would leak the
  token). Calls must originate server-side — which fits this slice (already a server-side lookup).
- Query language is **Apicalypse**: a `POST` whose body lists fields/filters, e.g.
  `fields name, genres.name; where ...; limit 1;`.

## Library options (TypeScript / Node)

| Library | Maturity | Notes |
|---|---|---|
| `@api-wrappers/igdb-wrapper` | ⚠️ Very new (Mar 2026, ~2 stars) | Best DX: type-safe fluent builder, **managed OAuth token, retries w/ backoff, built-in rate limiting**, structured errors (`IGDBRateLimitError`, …), pagination. Node 18+ native `fetch`. Feature-complete but unproven. |
| `igdb-api-node` (twitchtv, official-ish) | ✅ Mature, v6 Feb 2025, MIT | Maintained under the twitchtv org; wraps `node-apicalypse`. Low downloads (~268/wk). Less ergonomic token-refresh handling. |
| `igdb-api-types` | ✅ Stable, types only | Auto-generated TS types for every endpoint response. Zero runtime dependency — pair with raw `fetch`. |
| `igdb-ts`, `igdb-typeorm-entities` | ❌ | Stale (2022) / TypeORM-specific — not relevant to a Supabase stack. |

**Decision (resolved by the workerd compatibility spike below):** adopt
**`@api-wrappers/igdb-wrapper`**. It gives managed OAuth token + rate limiting + retries +
typed errors, and it verified clean on workerd. The raw-`fetch` + `igdb-api-types` fallback is
no longer needed.

### Workerd compatibility spike (2026-06-07) — PASSED ✅

Question: does `@api-wrappers/igdb-wrapper` load and run inside Cloudflare's workerd runtime
(the app's runtime), or must we fall back to raw `fetch`?

**Static analysis.** Full dependency tree is two packages only —
`@api-wrappers/igdb-wrapper@1.0.1 → @api-wrappers/api-core@1.0.2` (zero further deps). Grep of
the compiled `dist` found **no Node built-in imports** (`node:*`, `http`, `https`, `crypto`,
`fs`, `stream`, `buffer`, …), no `process`/`Buffer`/`__dirname`. All HTTP goes through
`globalThis.fetch`; timeouts via `AbortController` + `setTimeout` — all present in workerd.

**Build.** `npm run build` (Cloudflare adapter, workerd target) bundled cleanly — no `node:*`
resolution errors or externalization warnings for the package.

**Runtime.** A throwaway `GET /api/spike-igdb` endpoint (since deleted) instantiated the client
and issued a query under `npm run dev`. Response confirmed genuine workerd
(`navigator.userAgent === "Cloudflare-Workers"`), `moduleLoaded` + `instantiated` true, and the
call reached the network — the wrapper POSTed its OAuth token request to `id.twitch.tv` and
returned a typed `IGDBAuthError: 400 invalid client` (expected, since dummy creds were used).
This proves module load → instantiate → network fetch → structured error all work in workerd;
only valid Twitch credentials are missing (user's open action item).

**Footprint note.** `npm install` reported 124 added packages / 10 vulnerabilities — those were
the broader project `node_modules` being repopulated from a stale lockfile, **not** introduced
by this library (its tree is the 2 packages above).

## Field mapping — the required metadata + series

All of these except **overall length** come back from a single `games` query via field
expansion. Length requires a second call.

| Field | IGDB source | Stored as | Extra query? |
|---|---|---|---|
| Genre | `games.genres.name` (reference array; a game can have several) | `text[]` | no |
| Release year | `games.first_release_date` (Unix seconds) → year — *global first release* (recency signal) | `integer` | no |
| Release date | `games.release_dates` for the *matched platform* — per-platform precise date | `date` | no |
| Developer | `games.involved_companies` filtered `developer == true` → `company.name` (array) | `text[]` | no |
| **Series** | **`games.collections.name`** (plural — see below) | `text[]` | no |
| Overall length | **`/game_time_to_beats` endpoint**, `normally` field (seconds) | `numeric` (hours) | **yes** |

Example expansion for the single games query:
`fields name, genres.name, first_release_date, release_dates.*, involved_companies.developer, involved_companies.company.name, collections.name, platforms.name;`

## Series — added field (folded in)

IGDB has **two** series-like concepts; the naming is counterintuitive:

- **Collection = "Series"** (what we want). On the IGDB website this is literally labelled
  *"Series."* A Collection groups games sharing a theme/overarching story (e.g. *The Witcher*,
  *Mario*, *Halo*) — matching a user's mental model of "what series is this."
  - Source the field from **`games.collections` (plural)** → `.name`.
  - ⚠️ **Use `collections`, not `collection`.** IGDB migrated 1:many → many:many; the singular
    `collection` field is **deprecated** (deprecation window ended **August 2024**). The proto
    confirms `Collection collection = 9 [deprecated = true]` vs. live `repeated Collection collections = 58`.
  - Collection shape: `id`, `name`, `slug`, `type` (CollectionType), `games`, plus
    `as_parent_relations` / `as_child_relations` for sub-series nesting.
  - Comes back **on the games object** — no extra query; just add `collections.name` to fields.

- **Franchise = broader cross-media brand** (probably *not* what we want). Per IGDB's own
  contribution guidelines: a Franchise stretches beyond the main game series into other media
  (TV, film, comics, toys) — e.g. *Star Wars*. Fields: `franchise` (main, singular) and
  `franchises` (array). Too broad / inconsistently populated for a gaming library. **Stick with
  `collections`.**

**Storage (decided):** add a nullable **`series text[]`** field, sourced from `collections[].name`.
A game may belong to 0, 1, or several collections — the array preserves all of them. Coverage is
good for major franchises, spotty for indies/older titles — design for "no series" gracefully
(same posture as length).

## ⚠️ Overall length — answers the roadmap unknown

- The old single `game.time_to_beat` field is **deprecated**. Length now lives on a **separate
  endpoint** `/game_time_to_beats`, keyed by `game_id`, with `hastily` (rush) / `normally`
  (typical) / `completely` (100%) — all in **seconds** — plus a `count`. Use **`normally`** as
  "overall length."
- This means a **second query** (or an Apicalypse **multiquery**) after resolving the game id —
  it does not come back on the games object.
- **Coverage is sparse.** Many titles have *no* time-to-beat record. The roadmap's "handle
  missing length as unbucketed" assumption is correct and necessary — make length nullable and
  let S-07 absorb the gap. Genre / release date / developer / series are comparatively well
  populated for known titles; length is the field most likely to be absent.

## Limitations / gotchas

- **Rate limit: 4 requests/second, max 8 concurrent open requests** → `429` on breach. Default
  response limit is **10 items**; max **500** (`limit N;`). No separate per-minute/hour cap
  (confirmed by support); the old 50k/month cap was removed in v4.
- **Token lifecycle:** App Access Token valid **~60 days**, **max 25 active tokens** per app
  (older ones get invalidated past that). **Cache and refresh** server-side — do not mint per
  request. On Workers, KV or in-memory cache with expiry is a good fit.
- **Title+platform matching is fuzzy.** `search "..."` returns ranked guesses; filter by
  `platforms` and disambiguate editions/remasters/bundles via `game_type`. Most "no match" /
  wrong-match risk lives here. The "graceful no-match" result should cover both *zero results*
  and *low-confidence match*.
- **Licensing:** free for **non-commercial** use under the Twitch Developer Service Agreement.
  Flag if this product ever monetizes.
- **Caching IGDB responses** is the recommended pattern (Twitch dev forums) for both latency and
  staying under rate limits — relevant since FR-008 enriches eagerly at save time.

## Schema decisions (resolved)

These adjust `public.library_entries` (owned by the closed foundation **F-01 library-entry-store**).
They land as a *new* migration under this change — F-02 amends F-01's schema by design.

- **`genre`, `developer`, `series` → `text[]`.** All three are arrays in IGDB (genres,
  involved_companies with `developer=true`, collections). Storing arrays preserves multiple
  genres, **co-developed titles (multiple studios)**, and multi-series membership instead of
  flattening them.
- **Keep both `release_date` and `release_year`** with distinct semantics:
  - `release_date` (`date`) = per-platform precise date from `release_dates`, for the matched
    platform (the edition the user owns).
  - `release_year` (`integer`) = global first-release year from `first_release_date` — the
    recency signal feeding S-07/US-03 ranking.
  - Also justified by IGDB **date-precision flags**: a year may be known when an exact day isn't.
- Existing `library_entries` columns to change: `genre text → text[]`, `developer text → text[]`;
  **add** `series text[]`. `release_year`/`release_date` stay as-is.

## Implications for the lookup contract

- One `games` query (with field expansion) yields genre, release year/date, developer, and
  **series**; a second `/game_time_to_beats` query yields length.
- Make **length** and **series** nullable in the contract; both have imperfect coverage.
- Token management and the rate-limit guard (≤4 rps, ≤8 concurrent) are **handled by
  `@api-wrappers/igdb-wrapper`** — no need to hand-roll them.
- **Secrets convention (verified against the codebase, `research.md`):** pass `TWITCH_CLIENT_ID`
  /`TWITCH_CLIENT_SECRET` into the `IGDBClient` constructor from **`astro:env/server`**, not
  `process.env` — this repo reads server secrets only via `astro:env/server` and they are not
  surfaced on `process.env` on workerd. Declare both in `astro.config.mjs` env schema
  (`context: "server", access: "secret"`) and `.dev.vars(.example)`. The wrapper takes credentials
  as explicit config, so this is a source swap, not a wrapper incompatibility (see
  `library-reference.md` §1).
- **Workers nuance to settle in the plan:** the wrapper's token store is in-memory, but Workers
  isolates are ephemeral, so each cold isolate would re-fetch a Twitch token. Given Twitch's
  ~60-day validity and **25-active-token cap**, consider persisting the app access token in
  **Cloudflare KV** to avoid token churn across isolates.
  - ⚠️ **Correction — KV is greenfield (verified against the codebase, `research.md`).** An
    earlier draft of this note said "a SESSION KV binding already exists." **It does not** — there
    is no `kv_namespaces` in `wrangler.jsonc`, nothing in `astro.config.mjs`, and no runtime/KV
    typing. KV-backed token reuse is therefore a *net-new infra step*: the plan must create a KV
    namespace + `[[kv_namespaces]]` binding and read it per-request via
    `locals.runtime.env.<BINDING>` — a Cloudflare-runtime pattern used **nowhere** in this codebase
    today (everything resolves secrets at module load via `astro:env/server`). Because a KV binding
    is request-scoped, a token-caching client can't be a module-level singleton; construct it
    per-request so the wrapped `fetch` closes over the request's binding.
  - ⚠️ **Token gap confirmed (see `library-reference.md` §5).** `IGDBClientConfig` exposes **no
    token store, token-injection, or token-provider option** — there is **no first-class "seed
    the wrapper from KV" API**. The only interception points are the config's `fetch` and
    `transport` options. So KV-backed token reuse must be implemented by **wrapping the `fetch`
    option** to cache/short-circuit the `id.twitch.tv/oauth2/token` POST (read token from KV;
    on miss, let the request through and write the response back). This is a deliberate plan
    decision, not a config flag — flag it in the plan as the chosen mechanism, or accept
    per-isolate re-minting if the 25-token cap is judged acceptable for MVP traffic.
  - **MVP off-ramp (recommended):** given KV is greenfield, ship on the wrapper's in-memory token
    store with per-cold-isolate re-minting (within the ~60-day / 25-active-token budget) and defer
    KV unless token churn is shown to matter for the single-collector MVP.
