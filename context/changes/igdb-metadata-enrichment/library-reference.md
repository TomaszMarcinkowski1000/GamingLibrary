---
change_id: igdb-metadata-enrichment
kind: library-reference
created: 2026-06-07
library: "@api-wrappers/igdb-wrapper@1.0.1 (→ @api-wrappers/api-core)"
sources: Context7 (/websites/api-docs_igdb — IGDB v4 API semantics) + package docs at github.com/Api-Wrappers/igdb-wrapper/tree/main/docs
---

# `@api-wrappers/igdb-wrapper` — implementation reference

Consolidated API reference for the wrapper adopted in `external-research.md`. Sourced from
Context7 (IGDB v4 API semantics) plus the package's own docs on GitHub (client/builder API).
Organized around what F-02 actually needs: client setup, the two queries, error handling, and
the Workers token gap.

> The package is NOT indexed on Context7 (too new, Mar 2026). The IGDB v4 *API* is
> (`/websites/api-docs_igdb`); the wrapper-specific API below comes from its GitHub `docs/`.

## 1. Client setup

```ts
import { IGDBClient } from "@api-wrappers/igdb-wrapper";
import { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET } from "astro:env/server";

const client = new IGDBClient({
  clientId: TWITCH_CLIENT_ID,
  clientSecret: TWITCH_CLIENT_SECRET,
});
```

> ⚠️ **Secrets convention (verified against the codebase, `research.md`).** This repo reads
> server secrets **only** via `astro:env/server` — `process.env` is used nowhere and Astro's
> managed secrets are **not** surfaced on it on workerd, so a `process.env.TWITCH_*` snippet would
> read `undefined`. Declare both vars in `astro.config.mjs` env schema (`context: "server",
> access: "secret"`) and in `.dev.vars(.example)`, then import from `astro:env/server` as above.
> The wrapper takes credentials as explicit config, so this is a one-line source swap, not a
> wrapper-level incompatibility.

Full config interface:

```ts
interface IGDBClientConfig {
  clientId: string;
  clientSecret: string;
  retry?: Partial<RetryConfig>;        // maxAttempts, delayMs, jitter, retriableStatusCodes
  rateLimit?: RateLimitPluginOptions;  // maxConcurrent, minTimeMs, maxRequestsPerInterval, intervalMs
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;     // ← custom fetch (the Workers token escape hatch, see §5)
  transport?: Transport;
  plugins?: ApiPlugin[];
  logger?: LoggerInterface;
}
```

OAuth (Twitch `client_credentials`), retries-with-backoff, and the 4 rps / 8-concurrent rate
limit are all managed internally — you only supply the two Twitch secrets. Node 18+ native
`fetch` (verified clean on workerd in the spike recorded in `external-research.md`).

## 2. Endpoint properties (camelCase → IGDB v4)

| Property | IGDB endpoint |
|---|---|
| `client.games` | `games` |
| `client.gameTimeToBeats` | `game_time_to_beats` ← the length call |
| `client.genres` | `genres` |
| `client.platforms` | `platforms` |
| `client.collections` | `collections` |
| `client.involvedCompanies` | `involved_companies` |
| `client.companies` | `companies` |
| `client.releaseDates` | `release_dates` |

Each is an `IGDBEndpoint<T>` with: `.query()`, `.search(str)`, `.findById(id)`,
`.findMany()`, `.request("raw apicalypse;")`.

## 3. The two queries F-02 needs

**Query A — games (title + platform → genre, release year/date, developer, series):**

```ts
const match = await client.games
  .search(title)                                    // ranked full-text match
  .select((g) => ({
    id: g.id,
    name: g.name,
    firstReleaseDate: g.first_release_date,         // → release_year (global)
    genres: g.genres.$all,                          // → genre text[]
    involvedCompanies: g.involved_companies.$all,   // filter developer===true → developer text[]
    collections: g.collections.$all,                // → series text[]  (NOT collection — deprecated)
    releaseDates: g.release_dates.$all,             // → per-platform release_date
    platforms: g.platforms.$all,
  }))
  .where((g) => g.platforms.id.in(platformIds))     // platform filter
  .limit(1)
  .first();                                          // Game | null  → graceful no-match
```

Developer extraction needs the `developer === true` flag on involved_companies — can also be
pushed into the filter: `.where((g) => g.involved_companies.developer.eq(true))`.

**Query B — length (after you have `match.id`):**

```ts
const ttb = await client.gameTimeToBeats
  .query()
  .fields("normally", "hastily", "completely", "count", "game_id")
  .whereRaw(`game_id = ${match.id}`)
  .first();

const lengthHours = ttb?.normally ? ttb.normally / 3600 : null; // seconds → hours, nullable
```

Length is a **separate endpoint** with sparse coverage → keep nullable (matches the roadmap's
"unbucketed" assumption).

## 4. Query builder cheat-sheet (the bits F-02 uses)

- **Field selection:** `.select((g) => ({...}))` typed, or `.fields("name","platforms.name")` raw
  paths. `.$all` on a relation fetches all its fields. Omitting select = `fields *`.
- **Comparisons:** `.eq .not .gt .gte .lt .lte .in([]) .notIn([]) .isNull() .notNull()
  .startsWith .endsWith .containsText .contains .containsAll .exact` — text helpers accept
  `{ caseSensitive: false }`.
- **AND:** chain `.where()` calls or return an array from one. **OR:** `.where((g, { or }) =>
  or(a, b))`. **AND grouping:** `and()` helper. **Raw:** `.whereRaw("platforms = {48,6}")` /
  `.where((g,{raw})=>raw("..."))`.
- **Nested filter:** `.where((g) => g.involved_companies.developer.eq(true))`,
  `.where((g) => g.platforms.id.in([6,48]))`, `.where((g) => g.genres.id.eq(12))`.
- **Execution:** `.execute()` (all) · `.first()` (T|null) · `.firstOrThrow("games")` (throws
  `IGDBNotFoundError`) · `.count()` · `.paginate(n)` (async generator).
- **Escape hatches:** `.apicalypse("limit 10;")` appends a raw clause; `endpoint.request("full
  body;")` for a complete APICalypse string. `.explain()` / `.raw()` / `.debug()` to inspect the
  compiled query.

## 5. ⚠️ Token management gap (Workers) — see §5 note in external-research.md

`IGDBClientConfig` exposes **no token store, token-injection, or token-provider option**. There
is no first-class "seed the token from KV" API. The only interception points are the `fetch` and
`transport` options. On Workers, persisting the ~60-day app token in KV means **wrapping the
`fetch` option** to cache/short-circuit the `id.twitch.tv/oauth2/token` POST. The in-memory token
store otherwise re-fetches per cold isolate (25-active-token cap risk). Settle this explicitly in
the plan.

> ⚠️ **KV is greenfield here (verified against the codebase, `research.md`).** Earlier drafts of
> this change assumed a pre-existing "SESSION KV binding." **There is none** — no `kv_namespaces`
> in `wrangler.jsonc`, nothing in `astro.config.mjs` or the env typings. So the fetch-wrapping
> approach above is sound *as a mechanism* but presumes infra that does not yet exist. To take it,
> the plan must first (1) create a KV namespace + add a `[[kv_namespaces]]` binding to
> `wrangler.jsonc`, and (2) read it per-request via `locals.runtime.env.<BINDING>` — a
> Cloudflare-runtime pattern this codebase uses **nowhere** today. Note the scope split:
> `astro:env/server` secrets resolve at module load, but a KV binding is only available
> per-request, so a token-caching client cannot be a module-level singleton — it must be
> constructed per-request so the wrapped `fetch` closes over the request's KV binding.
>
> **MVP off-ramp:** accept the wrapper's in-memory token store and per-cold-isolate re-minting
> (within Twitch's ~60-day validity / 25-active-token budget) and defer all KV work. For
> single-collector MVP traffic this is likely fine; choose it unless cold-isolate token churn is
> shown to matter.

## 6. Error types (all extend `IGDBError`)

| Class | Thrown on | Properties |
|---|---|---|
| `IGDBAuthError` | 401 — bad/revoked creds | — |
| `IGDBRateLimitError` | 429 after retries exhausted | `retryAfterMs?: number` |
| `IGDBNotFoundError` | `.firstOrThrow()` / `findById()` no result | `endpoint: string` |
| `IGDBValidationError` | bad args (e.g. `limit()` outside 1–500) | — |

For F-02's graceful no-match, prefer `.first()` (returns `null`) over `.firstOrThrow()` so a miss
is a normal value, not an exception — reserve `IGDBNotFoundError` for explicit-throw paths.

## Full docs

`github.com/Api-Wrappers/igdb-wrapper/tree/main/docs` — getting-started, querying, endpoints,
error-handling, configuration, api-reference.
