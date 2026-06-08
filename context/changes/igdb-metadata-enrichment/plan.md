# IGDB Metadata Enrichment (F-02) Implementation Plan

## Overview

Build a server-side lookup that, given a `title` + `platform`, returns the five required metadata fields
(genre, overall length, release year, developer, release date) plus the folded-in **series** field from
IGDB, with a graceful typed no-match result. The lookup is a pure service module in `src/lib/services/` —
no UI, no public API route. Its consumers (S-01 manual save, S-03 photo save, S-07 recommender) are
downstream slices that will call it server-side.

The integration uses `@api-wrappers/igdb-wrapper@1.0.1`, which manages Twitch OAuth, retries, and the
rate-limit guard internally. Because Workers isolates are ephemeral, the Twitch app access token is cached
in **Cloudflare KV** (chosen over the in-memory MVP off-ramp) via a wrapped `fetch` that short-circuits the
`id.twitch.tv/oauth2/token` POST. A new migration amends F-01's `library_entries` schema by design.

## Current State Analysis

- **Runtime compatibility is proven.** A recorded workerd spike loaded, instantiated, and network-called the
  wrapper (`external-research.md:39-60`); `nodejs_compat` is on (`wrangler.jsonc:6`), and the wrapper's tree is
  two zero-Node-builtin packages using `globalThis.fetch` + `AbortController`. Only live Twitch credentials are
  missing (a non-blocking user action item).
- **Secrets convention is `astro:env/server`.** `src/lib/supabase.ts:3` imports secrets from that module; the
  env schema lives in `astro.config.mjs:17-22`. `process.env` is used nowhere — the wrapper's doc snippet must
  be adapted (it takes credentials as explicit config, so this is a one-line source swap).
- **KV is greenfield.** No `kv_namespaces` in `wrangler.jsonc` (only `ASSETS` + `observability`), nothing in
  `astro.config.mjs`, and `src/env.d.ts:1-5` types only `App.Locals.user` — no `runtime` typing. The
  `locals.runtime.env` Cloudflare pattern is used nowhere in the codebase today.
- **Schema is F-01's, scalar.** `supabase/migrations/20260606150950_create_library_entries.sql:16-22` defines
  `genre text`, `developer text`, `release_year integer`, `release_date date`, `length_hours numeric`,
  `igdb_id bigint`, `metadata_status text check (... 'matched','no_match')`. Types are derived in `src/types.ts`
  from the generated `src/db/database.types.ts` (regen via `npm run db:types`).
- **Tooling gaps.** `zod` is absent from `package.json`; `@api-wrappers/igdb-wrapper` is not installed;
  `src/lib/services/` does not exist; there is no test runner (no vitest/jest). Verification leans on
  `astro check`, `eslint`, `astro build`, and migration apply.

## Desired End State

A server-side function — `lookupGameMetadata(title, platform, kv)` in `src/lib/services/igdb.ts` — that:

- Returns a discriminated result: `{ status: "matched", igdbId, genre[], developer[], series[], releaseYear,
  releaseDate, lengthHours }` or `{ status: "no_match" }`.
- Validates input with a zod schema; throws a clear error on empty `title`/`platform`.
- Resolves the Twitch token through KV (cache hit ⇒ no Twitch round-trip; miss/expiry ⇒ fetch + write-back).
- Maps IGDB fields exactly to the widened `library_entries` columns (`genre`/`developer`/`series` as `text[]`,
  `length_hours` from `game_time_to_beats.normally` seconds→hours, nullable; `release_year` from
  `first_release_date`, `release_date` from the matched platform's `release_dates`).
- Returns `no_match` (never throws) when the platform-filtered title search yields zero results.

**Verification of end state:** `npm run typecheck`, `npm run lint`, `npm run build` all pass; the new migration
applies cleanly against local Supabase; `npm run db:types` regenerates without drift; and a throwaway dev
endpoint with live Twitch creds returns a populated `matched` result for a known title and `no_match` for a
nonsense title.

### Key Discoveries:

- KV binding is request-scoped (`locals.runtime.env.<BINDING>`) while `astro:env/server` secrets resolve at
  module load — so a token-caching client **cannot be a module-level singleton**; it must be built per-request
  so the wrapped `fetch` closes over the request's KV binding (`external-research.md:174-182`).
- The wrapper exposes **no token-store/token-provider hook** — the only interception points are `fetch` and
  `transport`. KV token reuse is therefore implemented by wrapping `fetch` to cache the token POST
  (`library-reference.md:133-156`).
- Length lives on a **separate endpoint** `game_time_to_beats` (`normally`, seconds), sparse coverage → nullable
  (`external-research.md:108-119`; query in `library-reference.md:100-113`).
- Series comes from `games.collections.name` (**plural** — singular `collection` is deprecated since Aug 2024)
  (`external-research.md:83-101`).
- Use `.first()` (returns `null`) not `.firstOrThrow()` so a miss is a normal value (`library-reference.md:166-168`).

## What We're NOT Doing

- No public/internal **API route** — service module only. S-01 will own the user-facing route.
- No **low-confidence / edition disambiguation** — a confident-but-wrong fuzzy match still returns `matched`;
  remaster/edition precision is deferred (roadmap §Parked).
- No **test runner** — no vitest/jest introduced in this foundation.
- No **Franchise** field — only Collection ("Series").
- No changes to **how platforms are entered** (free text from F-01); we only consume the existing value.
- No **observability** beyond existing `wrangler tail` / console.
- No **live deploy** of the KV namespace to production as a gate — binding is created and wired; production
  secret/namespace provisioning is a deploy-time follow-up noted in Migration Notes.

## Implementation Approach

Five phases, ordered so each is independently verifiable: (1) schema + types land first so the result DTO is
real; (2) config/deps/KV infra scaffolds the wiring; (3) the KV token-cache wrapper + per-request client factory
isolate the trickiest custom code; (4) the lookup service composes the factory with the two queries and field
mapping; (5) live verification once Twitch creds exist. Phases 1–4 can be implemented and statically verified
**without** live credentials; only Phase 5 needs them.

## Critical Implementation Details

**Env-scope split (Phase 3 ordering).** `astro:env/server` secrets (the Twitch creds) are available at module
load, but the KV binding is only available per-request via `locals.runtime.env`. The client factory must take
the KV namespace as an argument (resolved per-request by the caller) and read the Twitch creds from
`astro:env/server` at module scope. Do not construct a shared module-level `IGDBClient`.

**KV token-cache mechanism.** The wrapped `fetch` inspects the request URL: if it targets
`id.twitch.tv/oauth2/token`, check KV for a cached `{ access_token, expires_at }`. On a valid hit, return a
synthetic `Response` carrying that token JSON so the wrapper never hits Twitch. On miss/expiry, perform the real
fetch, read the JSON, write `{ access_token, expires_at }` to KV with a TTL slightly under Twitch's reported
`expires_in`, and return the original response. All other URLs pass through untouched.

**Platform resolution.** The `games` query filters on numeric IGDB platform ids, but `library_entries.platform`
is free text. Resolve via a small static map (the collector's console set, e.g. PS5/PS4/Switch/Xbox Series) to
IGDB platform ids. When the platform string is unrecognized, fall back to an **unfiltered** title search (still
`limit 1`) rather than failing — a best-effort match is preferable to a false `no_match`, and `metadata_status`
records the outcome either way.

## Phase 1: Schema migration + types

### Overview

Add a new migration that widens F-01's scalar metadata columns to arrays and adds `series`, then regenerate the
DB types and update the derived domain types plus the lookup-result DTO.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_enrich_library_entries_metadata.sql`

**Intent**: Amend F-01's `library_entries` so IGDB's multi-valued fields are preserved instead of flattened, and
add the new `series` field. F-02 amends F-01's schema by design (`change.md:32`).

**Contract**: `alter table public.library_entries`:
- `genre`: `text` → `text[]` (convert existing scalar via `using` clause wrapping non-null values into a
  single-element array; the table is empty in MVP but the `using` clause keeps it safe).
- `developer`: `text` → `text[]` (same conversion).
- add `series text[]` (nullable).
- `release_year`, `release_date`, `length_hours`, `igdb_id`, `metadata_status` unchanged. RLS/policies untouched
  (column-type changes don't affect row policies).

#### 2. Regenerate DB types

**File**: `src/db/database.types.ts`

**Intent**: Keep generated row types in sync with the migrated schema so derived types don't drift.

**Contract**: Output of `npm run db:types` after the migration applies. No hand edits.

#### 3. Domain + DTO types

**File**: `src/types.ts`

**Intent**: Surface the widened fields and define the lookup-result DTO the service returns.

**Contract**: `LibraryEntry`/`LibraryEntryInsert`/`LibraryEntryUpdate` continue deriving from the regenerated row
types (now `string[] | null` for genre/developer/series). Add an exported discriminated result type for the
lookup, e.g. `IgdbLookupResult = { status: "matched"; igdbId: number; genre: string[]; developer: string[];
series: string[]; releaseYear: number | null; releaseDate: string | null; lengthHours: number | null } | {
status: "no_match" }`. Field nullability mirrors IGDB coverage (length/series most likely absent).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against local Supabase: `npx supabase migration up` (or `npx supabase db reset`)
- DB types regenerate without uncommitted drift: `npm run db:types` then `git diff --exit-code src/db/database.types.ts` (after committing the intended regen)
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- `library_entries` shows `genre`/`developer`/`series` as array columns in the local DB
- `IgdbLookupResult` shape matches the five required fields + series

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual
confirmation before proceeding.

---

## Phase 2: Config, dependencies & KV infrastructure

### Overview

Declare the Twitch secrets in the env schema, install the wrapper + zod, create the KV namespace and binding,
and add the `runtime.env` typing the per-request client factory will rely on.

### Changes Required:

#### 1. Env schema secrets

**File**: `astro.config.mjs`

**Intent**: Make `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET` available via `astro:env/server`, matching the
existing Supabase-secret pattern.

**Contract**: Add two `envField.string({ context: "server", access: "secret", optional: true })` entries to the
`env.schema` block (optional so build/scaffold proceed without live creds).

#### 2. Local dev secrets template

**File**: `.dev.vars.example` (create if absent) and a note for `.dev.vars`

**Intent**: Document the two new secrets for local Cloudflare dev.

**Contract**: Add `TWITCH_CLIENT_ID=` and `TWITCH_CLIENT_SECRET=` placeholders. `.dev.vars` stays gitignored.

#### 3. Dependencies

**File**: `package.json`

**Intent**: Add the IGDB wrapper and zod.

**Contract**: `npm install @api-wrappers/igdb-wrapper@1.0.1 zod`. Both land in `dependencies`. Verify the wrapper
tree is still the two expected packages.

#### 4. KV namespace + binding

**File**: `wrangler.jsonc`

**Intent**: Create a KV namespace for the Twitch token cache and bind it for the Worker.

**Contract**: Create the namespace (`npx wrangler kv namespace create <NAME>`), then add a `kv_namespaces` array
to `wrangler.jsonc` with the returned `id` (and a `preview_id` for local dev) under a binding name such as
`IGDB_TOKENS`. Existing `assets`/`observability` config untouched.

#### 5. Runtime/KV typing

**File**: `src/env.d.ts`

**Intent**: Type `locals.runtime.env` so the KV binding is accessible type-safely per request.

**Contract**: Augment `App.Locals` with the Cloudflare runtime via the adapter's `Runtime` type from
`@astrojs/cloudflare`, exposing an `Env` that includes `IGDB_TOKENS: KVNamespace`. Keep the existing
`user: User | null`.

### Success Criteria:

#### Automated Verification:

- Type checking passes with the new runtime typing: `npm run typecheck`
- Build succeeds with the wrapper + KV binding present: `npm run build`
- Linting passes: `npm run lint`
- `wrangler.jsonc` parses (no schema errors) — confirmed by a successful `npm run build`

#### Manual Verification:

- `npx wrangler kv namespace list` shows the new namespace
- `locals.runtime.env.IGDB_TOKENS` resolves with type `KVNamespace` in an editor/typecheck context

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: KV token-cache fetch wrapper + per-request IGDB client factory

### Overview

Implement the trickiest custom code in isolation: a `fetch` wrapper that caches the Twitch app token in KV, and
a per-request factory that builds an `IGDBClient` wired with that wrapper and the `astro:env/server` creds.

### Changes Required:

#### 1. Token-cache fetch wrapper

**File**: `src/lib/services/igdb-token-cache.ts`

**Intent**: Short-circuit the Twitch token POST against KV so the ~60-day token is reused across isolates,
avoiding churn near the 25-active-token cap.

**Contract**: A factory `createTokenCachingFetch(kv: KVNamespace): typeof fetch`. The returned fetch: for
requests to `id.twitch.tv/oauth2/token`, read `{ access_token, expires_at }` from KV — on a valid hit return a
synthetic `Response` with that token JSON; on miss/expiry call the underlying `fetch`, persist
`{ access_token, expires_at }` (TTL slightly under `expires_in`), and return the response. All other requests
pass straight through. The synthetic response must match the shape the wrapper expects from the token endpoint
(`access_token`, `expires_in`, `token_type`).

#### 2. Per-request client factory

**File**: `src/lib/services/igdb.ts` (client factory section)

**Intent**: Construct an `IGDBClient` per request, fed the Twitch creds and the KV-caching fetch.

**Contract**: `createIgdbClient(kv: KVNamespace): IGDBClient`, reading `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`
from `astro:env/server` and passing `{ clientId, clientSecret, fetch: createTokenCachingFetch(kv) }` to the
constructor. Not a module-level singleton (KV is request-scoped).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Token-cache wrapper logic reviewed: cache-hit path returns without a real Twitch call; miss path writes to KV
- Factory constructs without throwing when creds are present (verified live in Phase 5)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Lookup service (validation, queries, mapping, no-match contract)

### Overview

Compose the per-request client with the two IGDB queries and map results to `IgdbLookupResult`, with zod input
validation, platform resolution, and the typed `no_match` path.

### Changes Required:

#### 1. Input schema + platform resolution

**File**: `src/lib/services/igdb.ts`

**Intent**: Validate `{ title, platform }` and translate the free-text platform into IGDB platform id(s).

**Contract**: A zod schema requiring non-empty trimmed `title` and `platform`; a static
`platform → IGDB platform id` map for the collector's console set with an unrecognized-platform fallback to an
unfiltered search (per Critical Implementation Details).

#### 2. Games query + length query + mapping

**File**: `src/lib/services/igdb.ts`

**Intent**: Run the `games` search (filtered by resolved platform) and, on a hit, the `game_time_to_beats`
query, then map both into the result DTO.

**Contract**: `lookupGameMetadata(title: string, platform: string, kv: KVNamespace): Promise<IgdbLookupResult>`.
Query A: `client.games.search(title).select({...}).where(platform filter).limit(1).first()` selecting `id`,
`first_release_date`, `genres.name`, `involved_companies` (with `company.name` + `developer`), `collections.name`,
`release_dates`, `platforms`. On `null` → return `{ status: "no_match" }`. Query B: `client.gameTimeToBeats`
filtered by `game_id` → `normally` seconds; `lengthHours = normally ? normally/3600 : null`. Map: `genre` from
`genres.name`; `developer` from `involved_companies` where `developer === true` → `company.name`; `series` from
`collections.name`; `releaseYear` from `first_release_date` (Unix→year); `releaseDate` from the matched
platform's `release_dates` entry. `series`/`length` nullable/empty-tolerant.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- Service signature returns the discriminated `IgdbLookupResult`; `no_match` path is a returned value, not a throw
- Field mapping reviewed against the schema columns (arrays for genre/developer/series; seconds→hours for length)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Live verification & harness cleanup

### Overview

With live Twitch credentials in `.dev.vars`, exercise the full path through a throwaway dev endpoint, confirm
both result branches and KV token reuse, then remove the harness.

### Changes Required:

#### 1. Throwaway verification endpoint

**File**: `src/pages/api/_spike-igdb.ts` (temporary, deleted at end of phase)

**Intent**: Drive `lookupGameMetadata` end-to-end under `npm run dev` against the real IGDB API, reading the KV
binding from `locals.runtime.env`.

**Contract**: A `GET` that calls the service with a query-param title/platform and returns the JSON result.
`export const prerender = false`. Removed before the phase closes.

### Success Criteria:

#### Automated Verification:

- After harness removal, no references remain: `npm run lint` and `npm run build` pass
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- A known title+platform (e.g. "The Witcher 3" / "PS5") returns a populated `matched` result with genre,
  developer, series, release year, release date, and (if available) length
- A nonsense title returns `{ status: "no_match" }` without throwing
- KV reuse confirmed: second request does not re-mint a Twitch token (token key present in
  `npx wrangler kv key list`, or no second token POST observed in `wrangler tail`/dev logs)
- Harness endpoint deleted

**Implementation Note**: This phase requires live `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET` (user action item).
Phases 1–4 can complete and verify without them.

---

## Testing Strategy

No automated test runner is introduced (decision: typecheck/lint/build + manual harness). Verification relies on:

### Static checks (every phase):

- `npm run typecheck` (`astro check`), `npm run lint`, `npm run build`

### Migration checks (Phase 1):

- `npx supabase migration up` / `db reset` applies cleanly; `npm run db:types` produces no unexpected drift

### Manual integration (Phase 5):

1. Set live Twitch creds in `.dev.vars`; `npm run dev`
2. Hit the harness with a known title+platform → verify populated `matched` result and correct field mapping
3. Hit with a nonsense title → verify `no_match`
4. Repeat the known-title call → verify the Twitch token is served from KV (no re-mint)
5. Verify graceful handling when length/series are absent (a title known to lack time-to-beat data)

## Performance Considerations

- The wrapper enforces the 4 rps / 8-concurrent rate-limit guard internally; the lookup issues at most two
  IGDB queries (games + length) per call.
- KV token caching removes a Twitch OAuth round-trip from the common path, reducing latency and token churn.
- Per-request client construction is cheap (no network at construction); the only network is the lookup itself.

## Migration Notes

- The migration amends F-01's `library_entries` (`text`→`text[]` for genre/developer, add `series`). MVP table is
  empty; the `using` clause keeps the conversion safe even if rows exist.
- **Production provisioning (deploy-time follow-up, not gated by this plan):** create the production KV namespace,
  add its `id` to `wrangler.jsonc`, and set `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET` as Worker secrets
  (`npx wrangler secret put ...`) before the lookup runs in production.

## References

- Internal research: `context/changes/igdb-metadata-enrichment/research.md`
- External research: `context/changes/igdb-metadata-enrichment/external-research.md`
- Library reference: `context/changes/igdb-metadata-enrichment/library-reference.md`
- Change identity/decisions: `context/changes/igdb-metadata-enrichment/change.md`
- F-01 schema: `supabase/migrations/20260606150950_create_library_entries.sql:7-44`
- Secret pattern: `src/lib/supabase.ts:3`; env schema: `astro.config.mjs:17-22`
- API-route convention: `src/pages/api/auth/signin.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema migration + types

#### Automated

- [x] 1.1 Migration applies cleanly against local Supabase
- [x] 1.2 DB types regenerate without uncommitted drift
- [x] 1.3 Type checking passes
- [x] 1.4 Linting passes

#### Manual

- [x] 1.5 library_entries shows genre/developer/series as array columns
- [x] 1.6 IgdbLookupResult shape matches the five required fields + series

### Phase 2: Config, dependencies & KV infrastructure

#### Automated

- [ ] 2.1 Type checking passes with the new runtime typing
- [ ] 2.2 Build succeeds with the wrapper + KV binding present
- [ ] 2.3 Linting passes
- [ ] 2.4 wrangler.jsonc parses (successful build)

#### Manual

- [ ] 2.5 KV namespace appears in `wrangler kv namespace list`
- [ ] 2.6 locals.runtime.env.IGDB_TOKENS resolves as KVNamespace

### Phase 3: KV token-cache fetch wrapper + per-request IGDB client factory

#### Automated

- [ ] 3.1 Type checking passes
- [ ] 3.2 Build succeeds
- [ ] 3.3 Linting passes

#### Manual

- [ ] 3.4 Token-cache wrapper hit/miss logic reviewed
- [ ] 3.5 Factory constructs without throwing when creds present

### Phase 4: Lookup service (validation, queries, mapping, no-match contract)

#### Automated

- [ ] 4.1 Type checking passes
- [ ] 4.2 Build succeeds
- [ ] 4.3 Linting passes

#### Manual

- [ ] 4.4 Service returns discriminated IgdbLookupResult; no_match is a value not a throw
- [ ] 4.5 Field mapping reviewed against schema columns

### Phase 5: Live verification & harness cleanup

#### Automated

- [ ] 5.1 No harness references remain (lint + build pass)
- [ ] 5.2 Type checking passes

#### Manual

- [ ] 5.3 Known title+platform returns populated matched result
- [ ] 5.4 Nonsense title returns no_match without throwing
- [ ] 5.5 KV token reuse confirmed (no re-mint on second call)
- [ ] 5.6 Harness endpoint deleted
