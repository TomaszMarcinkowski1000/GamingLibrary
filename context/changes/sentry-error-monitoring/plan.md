# Sentry Error Monitoring Implementation Plan

## Overview

Wire Sentry as the production error-monitoring sink for this Astro 6 SSR app on Cloudflare Workers.
Two hook points, and only two: `Sentry.withSentry()` at the Worker entrypoint catches **unhandled**
throws, and a single `captureException` inside `src/lib/logger.ts` catches every **handled** failure
that already routes through `logError`. No `catch` block in the app is touched.

Scope is deliberately narrow: errors only (no tracing), server only (no browser SDK), production
only (no DSN locally or in CI). Source maps are uploaded so production stack traces are readable.

## Current State Analysis

The observability seam this plan plugs into already exists — it was built for exactly this in the
preceding `error-propagation-observability` change (commit `f5b95e7`).

- **`src/lib/logger.ts`** is the sole log sink. `logError(event, error, fields)` (`logger.ts:51`)
  and `logWarning(event, fields)` (`logger.ts:60`) each emit one JSON line to
  `console.error` / `console.warn`. Its header comment names Sentry as the intended future hook:
  _"one `captureException` call here, not one per `catch`."_
- **26 call sites across 10 files** route through it — `src/pages/api/{identify,library/*,auth/signin}.ts`,
  `src/lib/services/{library,igdb-token-cache}.ts`, and two `.astro` pages. Event names are stable
  dot-namespaced identifiers (`library.create.enrichment_failed`), chosen so occurrences group across
  deploys. Several call sites already pass `userId` in `fields`.
- **`serializeError`** (`logger.ts:33`) already reduces `unknown` throws to JSON-safe shapes, so the
  console path is unaffected by anything this plan adds.
- **Worker entrypoint** is the adapter default: `wrangler.jsonc:3` has
  `"main": "@astrojs/cloudflare/entrypoints/server"`. There is no custom entrypoint file today.
- **`nodejs_compat`** is enabled (`wrangler.jsonc:5`). This is load-bearing: `withSentry` uses
  AsyncLocalStorage to scope the Sentry client to the in-flight request, which is what makes a bare
  `captureException` inside `logger.ts` attach to the right request without threading a client through
  every call.
- **`observability.enabled: true`** (`wrangler.jsonc`) — Cloudflare Workers Logs is the current sink.
  Sentry is **additive**; the `console.*` lines stay exactly as they are.
- **Env schema pattern** — `astro.config.mjs:27-38` declares every server secret via
  `envField.string({ context: "server", access: "secret", optional: true })`. `optional: true` is a
  deliberate convention here: builds and CI must proceed without the value.
- **Secrets flow** — `.dev.vars` (Cloudflare local dev, gitignored), `.env` (Node-side tooling),
  `wrangler secret put` (production), documented in `.env.example`.
- **Deploy has two paths, and this bullet originally named only one.** ⚠️ **Corrected after the fact
  — see the Phase 3 `cf16416` addendum.** As written during planning it said *"Deploy is manual —
  `npx wrangler deploy` … there is no deploy workflow"*. The second clause is true of
  `.github/workflows/` (which holds only `ci.yml` and `migrate.yml`) but false of the system:
  **Cloudflare Workers Builds auto-deploys every push to `main`**, configured in the dashboard rather
  than in the repo, recorded and verified 2026-06-02 in
  `context/changes/deployment/deployment-plan.md:188-203`. A dashboard-configured deploy leaves no
  file in the repo to grep for, which is how planning missed it. Consequence for this change: the
  auto-deploy path is the one that matters most, and it needed wiring too.
- **Tests** — vitest, `src/**/*.test.ts`, 9 suites exist. `vitest.config.ts` aliases `astro:env/server`
  to a stub and installs a deny-all `fetch` (`test/setup/no-network.ts`). There is **no**
  `src/lib/logger.test.ts` today. `lint-staged` runs `vitest related --run` on staged `*.ts`.

### Key Discoveries:

- **The Cloudflare×Astro path is not the vanilla `@sentry/astro` path.** For Astro 6 with
  `@astrojs/cloudflare` v13, Sentry's documented setup is a **custom entrypoint** that wraps the
  adapter handler with `Sentry.withSentry()`, plus `wrangler.jsonc` `main` repointed at it. The
  automatic adapter detection described for Astro 3-5 / adapter v12 does not apply.
- **`logError` alone is not full coverage.** It only sees failures someone already caught. The
  entrypoint wrapper is what catches the rest. Both are needed; they are not redundant.
- **`captureException` no-ops when the SDK was never initialized.** Because the DSN is read at the
  entrypoint (`env.SENTRY_DSN`), `logger.ts` needs **no env access at all** — no `astro:env/server`
  import, no vitest stub change, and unset-DSN environments degrade to console-only automatically.
- **`POST /api/identify` carries base64 shelf photos.** Automatic HTTP-body collection would ship user
  images to a third party. `dataCollection.httpBodies` must be explicitly disabled.
- **`lessons.md` rule applies to the entrypoint**: do not reach for `Astro.locals.runtime.env`. The
  `withSentry` callback receives `env` directly, which is the correct access path here.

## Desired End State

A production error in GamingLibrary appears in Sentry within seconds, grouped by its stable `event`
name, carrying the `userId` of the affected account and the structured `fields` the call site passed,
with a readable stack trace pointing at real source lines. Local development and CI are unaffected:
no DSN, no events, no build-time dependency on a Sentry account.

Verify by: deploying, triggering a real failure, and finding it in the Sentry issue stream with an
unminified trace — while `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all pass
on a machine with no Sentry credentials whatsoever.

## What We're NOT Doing

- **No browser SDK.** No `sentry.client.config.js`, no client-side error capture, no Session Replay.
  React island crashes stay invisible to Sentry — accepted.
- **No performance tracing.** `tracesSampleRate: 0`. No latency data on the IGDB / OpenRouter calls.
- **No `logWarning` forwarding.** Warnings stay console-only. `auth.signin.malformed_request` fires on
  any malformed POST and would flood the free-plan quota.
- **No Sentry Logs stream** (`enableLogs`). Cloudflare Workers Logs already stores the JSON lines.
- **No changes to any `catch` block.** The whole point of `logger.ts` is that this stays true.
- **No removal of `console.error` / `console.warn`.** Cloudflare Workers Logs remains a parallel sink.
- **No alerting/notification rules, dashboards, or release tracking.** Out of scope for this change.
- **No CI deploy workflow.** Still honored in substance — `.github/workflows/` gains nothing, and it
  still holds only `ci.yml` and `migrate.yml`. But the original wording, *"Deploy stays manual"*, was
  false when written: Workers Builds already auto-deployed every push to `main` (see the corrected
  Current State bullet). What this guardrail actually means here is "no new deploy automation" — and
  `cf16416` added none; it repointed the existing dashboard deploy command at this change's script.
- **No DSN in CI.** The e2e suite deliberately triggers errors; they must not reach the dashboard.

## Implementation Approach

Three phases, each independently verifiable:

1. **Entrypoint first.** Stand up the SDK at the Worker boundary with a prod-only DSN. This alone
   makes unhandled throws observable and proves the wiring before any app code changes.
2. **Logger second.** One `captureException` in the existing seam lights up all 26 handled call sites
   at once, guarded by a unit test that locks the contract.
3. **Source maps last.** Readability is a separate concern from delivery, and it introduces the only
   build-time credential — kept isolated so a failure here cannot break phases 1-2.

## Critical Implementation Details

**Timing & lifecycle.** `withSentry` establishes an AsyncLocalStorage scope per request; the
`captureException` inside `logger.ts` resolves its client from that scope. This works only because
`nodejs_compat` is on (`wrangler.jsonc:5`). If a future change drops that flag, handled errors will
silently stop reaching Sentry while unhandled ones keep working — a confusing partial failure worth
knowing about up front.

**Debug & observability.** The absence of events is not proof of absence of errors. Phase 1's manual
criterion must be a *deliberately triggered* error, not "nothing showed up, looks fine."

---

## Phase 1: Sentry project + Worker entrypoint wiring

### Overview

Create the Sentry project, install the Cloudflare SDK, and wrap the Worker entrypoint. After this
phase, an unhandled throw in production reaches Sentry; nothing else in the app has changed.

### Changes Required:

#### 1. Sentry account setup (manual, blocking)

**Intent**: Create a free-plan Sentry project and obtain the three values the rest of the plan needs.
This is the human's step; no credential passes through the implementing agent.

**Contract**: The human provides, and stores appropriately:

- `SENTRY_DSN` — the project DSN. Goes to production only, via `npx wrangler secret put SENTRY_DSN`.
- `SENTRY_ORG` — organization slug. Needed in Phase 3 (`astro.config.mjs`, not secret).
- `SENTRY_PROJECT` — project slug. Needed in Phase 3 (not secret).

Platform selection when creating the project: **JavaScript → Cloudflare**. Do not run Sentry's
suggested wizard/CLI installer — it targets the vanilla Astro (Node) path and would write a
conflicting configuration.

#### 2. SDK dependency

**File**: `package.json`

**Intent**: Add the Cloudflare Workers Sentry SDK as a runtime dependency. `@sentry/astro` is not
needed until Phase 3 and is added there.

**Contract**: `@sentry/cloudflare` in `dependencies` (it ships in the Worker bundle, so it is a
dependency, not a devDependency).

#### 3. Worker entrypoint wrapper

**File**: `sentry.server.config.ts` (new, repo root — sibling of `astro.config.mjs`)

**Intent**: Become the Worker's entry module. Wrap the Astro Cloudflare adapter's handler with
`Sentry.withSentry`, reading the DSN from the Worker `env` so an unset DSN yields a no-op SDK.

**Contract**: Default-exports `Sentry.withSentry(optionsCallback, handler)` where `handler` is the
default export of `@astrojs/cloudflare/entrypoints/server`. The options callback receives `env` and
returns:

- `dsn: env.SENTRY_DSN`
- `tracesSampleRate: 0` — errors only (see "What We're NOT Doing")
- `dataCollection: { userInfo: false, httpBodies: [] }` — the httpBodies suppression is
  load-bearing, not cosmetic: `POST /api/identify` bodies contain base64 user photos
- `environment: "production"`

This file is the only place a DSN is read. Add a header comment stating that, and stating that an
unset DSN is the intended local/CI configuration — not a misconfiguration — so a future reader does
not "fix" it by making the DSN required.

#### 4. Worker main repoint

**File**: `wrangler.jsonc`

**Intent**: Point the Worker at the wrapper instead of the adapter handler directly.

**Contract**: `"main": "./sentry.server.config.ts"` replaces
`"main": "@astrojs/cloudflare/entrypoints/server"`. Everything else in the file is unchanged. Add a
short comment noting the wrapper re-exports the adapter handler, so the indirection is not mistaken
for a stray file.

#### 5. Env schema declaration

**File**: `astro.config.mjs`

**Intent**: Declare `SENTRY_DSN` alongside the other server secrets so it is a known, typed part of
the app's configuration surface.

**Contract**: `SENTRY_DSN: envField.string({ context: "server", access: "secret", optional: true })`
in the `env.schema` block. `optional: true` matches the established convention (`astro.config.mjs:29-37`)
and is required for builds/CI to proceed without a Sentry account.

#### 6. Secret documentation

**File**: `.env.example`

**Intent**: Document what `SENTRY_DSN` is, where it goes, and — most importantly — that leaving it
unset is the correct local and CI configuration, mirroring how `E2E_VISION_STUB_KEY` documents its own
"unset means disarmed" semantics.

**Contract**: A commented `SENTRY_DSN=###` block covering: production-only via
`wrangler secret put SENTRY_DSN`; unset locally so the SDK no-ops; setting it in `.dev.vars`
temporarily is how you verify the wiring by hand; never set it in CI, because the e2e suite
deliberately triggers errors.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Build succeeds with no `SENTRY_DSN` present: `npm run build`
- Unit tests still pass: `npm test`
- Dev server boots and serves `/`: `npm run dev`

#### Manual Verification:

- With a DSN temporarily in `.dev.vars` and the dev server restarted, a deliberately thrown error in a
  route surfaces as an issue in the Sentry project
- With the DSN removed from `.dev.vars` (and the server restarted), the same thrown error produces no
  Sentry event and the app behaves identically to before this change
- `npx wrangler deploy` succeeds against the repointed `main`

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding to Phase 2.

---

## Phase 2: `logError` → `captureException`, with a contract test

### Overview

Add the single `captureException` call the logger module was designed around. All 26 handled-failure
call sites begin reporting, with zero changes outside `src/lib/logger.ts` and one new test file.

### Changes Required:

#### 1. Logger Sentry hook

**File**: `src/lib/logger.ts`

**Intent**: In `logError`, after the existing `console.error`, forward the error to Sentry with enough
structure to group and triage it. `logWarning` is untouched — that is a decision, and the file should
say so.

**Contract**: `logError` calls `Sentry.captureException(error, ...)` with:

- `tags: { event }` — the dot-namespaced event name is the grouping key; as a tag it is filterable and
  searchable in the issue stream, which a nested context field would not be
- `extra: fields` — the structured context the call site passed
- `user: { id: fields.userId }` **only when `fields.userId` is a string** — promotes the existing
  convention (`api/library/index.ts:56`, `api/library/[id].ts:51`) into Sentry's first-class user
  field, so "one broken account" is distinguishable from "an outage". No email, no IP.

Ordering matters: `console.error` runs **first**, unconditionally. A throw from the Sentry SDK must
never cost the app its existing log line. Wrap the capture so a failure inside it cannot propagate into
the caller's `catch` handling.

The module header comment currently reads _"This is also the single seam a real error tracker (Sentry)
hooks into **later**"_ — update it to reflect that this is now wired, that `logWarning` is deliberately
not forwarded, and that the SDK is initialized at `sentry.server.config.ts` (so no DSN handling belongs
in this file).

#### 2. Logger unit test

**File**: `src/lib/logger.test.ts` (new)

**Intent**: Lock the contract the rest of the app depends on. `vitest related --run` in `lint-staged`
means this runs automatically whenever `logger.ts` is staged, so a later refactor cannot quietly drop
the capture.

**Contract**: `vi.mock("@sentry/cloudflare")` following the existing mocking style in
`src/lib/services/library.test.ts:13`. Cases:

- `logError` calls `captureException` once, with the thrown value, `tags.event` set to the event name,
  and `extra` carrying the passed fields
- `logError` sets `user.id` when `fields.userId` is a string, and omits `user` entirely when it is
  absent or not a string
- `logWarning` never calls `captureException`
- `console.error` / `console.warn` output is byte-identical to before — the existing JSON-line shape,
  including `serializeError`'s handling of an `Error` with a `cause`, is unchanged
- A `captureException` that throws does not propagate out of `logError`

### Success Criteria:

#### Automated Verification:

- New logger tests pass: `npm test`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`
- Staging `src/lib/logger.ts` triggers the new test via the pre-commit hook

#### Manual Verification:

- With a DSN temporarily in `.dev.vars`, a real handled failure (e.g. an IGDB lookup against
  deliberately broken Twitch credentials, hitting `library.lookup.igdb_unavailable`) appears in Sentry
  tagged with that event name
- The issue carries the affected `userId` and the call site's structured fields
- The app's user-facing behavior is unchanged — the degraded-success path still returns the entry

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding to Phase 3.

---

## Phase 3: Source maps + production verification

### Overview

Make production stack traces readable, and confirm no Sentry code reached the client bundle. This is
the only phase that introduces a build-time credential.

### Changes Required:

#### 1. Astro integration for source-map upload

**File**: `astro.config.mjs`, `package.json`

**Intent**: Add `@sentry/astro` purely as a build-time source-map uploader. Server runtime init stays
in `sentry.server.config.ts`; the integration must not also try to instrument the request handler.

**Contract**: `@sentry/astro` added to `devDependencies` (build-time only — it must not enter the
Worker bundle). In `astro.config.mjs`, `sentry({...})` joins the `integrations` array with:

- `org` / `project` — the slugs from Phase 1, read from `process.env` with the values documented in
  `.env.example`
- `authToken: process.env.SENTRY_AUTH_TOKEN`
- `autoInstrumentation: { requestHandler: false }` — the Cloudflare entrypoint owns server init;
  leaving this on would double-instrument

A missing `SENTRY_AUTH_TOKEN` must degrade to "skip upload with a warning", never a build failure —
CI builds run without one. This is asserted in the automated criteria below, not assumed.

#### 2. Wrangler source-map generation

**File**: `wrangler.jsonc`

**Intent**: Have wrangler emit source maps for the deployed Worker bundle.

**Contract**: `"upload_source_maps": true` at the top level.

#### 3. Build-credential documentation

**File**: `.env.example`

**Intent**: Document `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` as **deploy-time**
credentials distinct from the runtime `SENTRY_DSN` — a distinction that is easy to get wrong and
expensive to debug.

**Contract**: A commented block noting: the auth token is created in Sentry under
_Settings → Auth Tokens_ with source-map upload scope; it lives in `.env` on the deploying developer's
machine, never in `.dev.vars` (it is not a Worker runtime value) and never committed; org/project are
not secret; absence of the token skips upload rather than failing the build.

#### 4. Client-bundle assertion

**File**: n/a — verification step

**Intent**: Prove the "server only" decision actually held. The `@sentry/astro` integration is
capable of injecting client-side instrumentation, and a silent regression here would ship ~30-40kB of
unwanted JS to every page.

**Contract**: After `npm run build`, no file under `dist/_astro/` contains Sentry SDK code. Record the
concrete check used (a grep over the built client assets) in the plan's manual notes so it can be
repeated after future dependency bumps.

### Success Criteria:

#### Automated Verification:

- Build succeeds with **no** `SENTRY_AUTH_TOKEN` in the environment: `npm run build`
- Build succeeds **with** the auth token present and reports a successful source-map upload
- No Sentry code in the built client bundle: grep `dist/_astro/` finds no SDK references
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Full test suite passes: `npm test`
- CI is green on the branch (the `ci` and `e2e` jobs both run without any Sentry credentials)

#### Manual Verification:

- `npx wrangler deploy` completes and uploads source maps
- A deliberately triggered production error appears in Sentry with an **unminified** stack trace
  pointing at real `src/` paths and line numbers
- The issue's `event` tag matches the call site's identifier and its `userId` matches the test account
- No client-side JS payload regression on `/library` (page weight unchanged from before this change)
- The Sentry project shows **zero** events originating from local development or CI runs

**Implementation Note**: This is the final phase. After manual verification, remove any temporary DSN
from `.dev.vars`.

---

## Testing Strategy

### Unit Tests:

- `src/lib/logger.test.ts` (new) — the full contract listed in Phase 2, with `@sentry/cloudflare`
  mocked via `vi.mock`, matching the isolation style of `src/lib/services/library.test.ts`
- Key edge cases: `fields.userId` absent; `fields.userId` present but not a string; `Error` with a
  `cause` chain (guards `serializeError` against regression); `captureException` itself throwing

### Integration Tests:

- None added. The Sentry path cannot be meaningfully integration-tested without either a live DSN
  (which would pollute the dashboard from CI — explicitly out of scope) or a mock transport that would
  test the SDK rather than this code. The end-to-end proof is the manual production verification in
  Phase 3.

### Manual Testing Steps:

1. Put the DSN in `.dev.vars`, restart the dev server (Astro binds secrets at worker init — an edit
   without a restart keeps the stale value).
2. Break the Twitch credentials in `.dev.vars` and add a library entry — confirm
   `library.lookup.igdb_unavailable` reaches Sentry with the right tag and `userId`, and that the entry
   is still created (degraded success preserved).
3. Remove the DSN, restart, repeat step 2 — confirm no event, identical app behavior.
4. Deploy; trigger the same failure in production; confirm the trace is unminified.
5. Confirm the Sentry project contains no events from CI runs after a full CI pass.

## Performance Considerations

`captureException` is fire-and-forget over the Worker's async context; it adds no blocking latency to
the response path. The `@sentry/cloudflare` bundle grows the Worker slightly — well within Cloudflare's
limits at this size, but worth noting since the Worker bundle also carries the Astro SSR output.
Errors-only (`tracesSampleRate: 0`) means no per-request instrumentation overhead on the happy path.

## Migration Notes

Nothing to migrate. Rollback is `git revert` plus `npx wrangler secret delete SENTRY_DSN`; the console
logging path is untouched throughout, so reverting loses Sentry and nothing else. Phase 1 is
independently revertible by restoring `wrangler.jsonc`'s `main`.

## References

- Change identity: `context/changes/sentry-error-monitoring/change.md`
- Plan brief: `context/changes/sentry-error-monitoring/plan-brief.md`
- The seam this plugs into: `src/lib/logger.ts:20` (the comment that anticipated this change)
- Prior change that built it: commit `f5b95e7` (`error-propagation-observability`)
- Secret-documentation pattern to mirror: `.env.example`, the `E2E_VISION_STUB_KEY` block
- Env-schema pattern: `astro.config.mjs:27-38`
- Test-mocking pattern: `src/lib/services/library.test.ts:13`
- Cloudflare-binding rule: `context/foundation/lessons.md` — do not use `locals.runtime.env`
- Sentry docs: https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/astro

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Sentry project + Worker entrypoint wiring

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — 0c277ee
- [x] 1.2 Lint passes: `npm run lint` — 0c277ee
- [x] 1.3 Build succeeds with no `SENTRY_DSN` present: `npm run build` — 0c277ee
- [x] 1.4 Unit tests still pass: `npm test` — 0c277ee
- [x] 1.5 Dev server boots and serves `/`: `npm run dev` — 0c277ee

#### Manual

- [x] 1.6 Thrown error with DSN in `.dev.vars` surfaces as a Sentry issue — 0c277ee
- [x] 1.7 Same error with DSN removed produces no event and identical app behavior — 0c277ee
- [x] 1.8 `npx wrangler deploy` succeeds against the repointed `main` — deferred to Phase 3's deploy and settled there: `npm run deploy` shipped 2f4f62a to production. Wrangler reports `Using redirected Wrangler configuration → dist/server/wrangler.json`, and the repointed `main` is present in the deployed bundle as `chunks/worker-entry_*.mjs` — 2f4f62a

### Phase 2: `logError` → `captureException`, with a contract test

#### Automated

- [x] 2.1 New logger tests pass: `npm test` — d3d41b7
- [x] 2.2 Typecheck passes: `npm run typecheck` — d3d41b7
- [x] 2.3 Lint passes: `npm run lint` — d3d41b7
- [x] 2.4 Build succeeds: `npm run build` — d3d41b7
- [x] 2.5 Staging `src/lib/logger.ts` triggers the new test via the pre-commit hook — d3d41b7

#### Manual

- [x] 2.6 Real handled failure appears in Sentry tagged with its event name — verified live on `library.create.enrichment_failed` — d3d41b7
- [x] 2.7 Issue carries the affected `userId` and the call site's structured fields — `extra` (`title`, `platform`) verified live; the `userId` half is not observable here, because none of the call sites an IGDB outage reaches passes one (`services/library.ts:72`, `api/library/lookup.ts:47`) — only the five DB-failure sites do. Covered instead by the three `src/lib/logger.test.ts` cases: present-string, absent, non-string — d3d41b7
- [x] 2.8 User-facing behavior unchanged — degraded-success path still returns the entry — d3d41b7

### Phase 3: Source maps + production verification

#### Automated

> **Phase 3 approach deviation (agreed before implementation).** The plan's §3.1 contract —
> `@sentry/astro` as a pure build-time source-map uploader — does not hold against
> `@sentry/astro@10.68.0`. Measured: built exactly as specified it ships the browser SDK
> (`dist/client/_astro` 461.96 KB → 739.3 KB, a new 269 KB `page.*.js` carrying
> `browserTracingIntegration`), because `autoInstrumentation.requestHandler: false` governs only
> the SSR middleware. `enabled: { client: false }` fixes that, but `server: false` cannot also be
> set: the integration derives `shouldUploadSourcemaps` from `sdkEnabled.client || sdkEnabled.server`,
> so disabling both silently disables the upload. Separately, the maps it uploads describe Astro's
> vite output, not the bundle wrangler deploys. Replaced with Sentry's documented Cloudflare path:
> no Astro-level plugin, an SSR-scoped sourcemap vite plugin in `astro.config.mjs`, and
> `npm run deploy` (`scripts/deploy-worker.mjs`) doing build → `sentry-cli sourcemaps inject
> dist/server` → `wrangler deploy` → upload. `dist/server` is the right target because
> `@astrojs/cloudflare` sets `no_bundle: true`, so wrangler ships those modules verbatim.
> Consequence for the criteria below: source-map upload moved out of the build and into the deploy,
> so 3.2 is no longer a build-time assertion and is folded into 3.8.
>
> **Release tagging came with it, overriding one line of "What We're NOT Doing".** The deploy script
> resolves the deployed commit (`resolveRelease()`), passes it as `wrangler deploy --var
> SENTRY_RELEASE:<sha>`, tags the upload `--release <sha>`, and the entrypoint reads it back as
> `release: env.SENTRY_RELEASE`. That is "release tracking", which §"What We're NOT Doing" excludes.
> Recorded rather than reverted: once the deploy script exists, the release is one already-known
> value threaded through three calls, and it is what makes an issue say *which* deploy introduced it.
> To be precise about what it is not: it is **not** required for readable traces. `sentry-cli
> sourcemaps inject` pairs events to artifacts by debug ID, which works with no release at all — so
> if this ever needs removing, the source-map chain survives it intact.

- [x] 3.1 Build succeeds with no `SENTRY_AUTH_TOKEN` in the environment — exit 0; now structurally guaranteed, since nothing in the build path reads any Sentry credential — 2f4f62a
- [x] 3.2 Build succeeds with the auth token present and uploads source maps — satisfied by restatement: the upload is a deploy step now, not a build step, so this cannot be asserted against `npm run build`. Its intent — "with credentials present, maps actually reach Sentry" — is what 3.8 (94 files injected and uploaded) and 3.9 (frames resolving to real `src/` paths in production) prove together. The complementary "without credentials" half is still asserted at build time by 3.1 — 2f4f62a
- [x] 3.3 No Sentry code in the built client bundle — grep is over `dist/client/_astro/` (the adapter emits `dist/client` + `dist/server`, not `dist/_astro`). Repeat after dependency bumps with: `Get-ChildItem -Recurse dist/client -File | Where-Object { Select-String -Path $_.FullName -Pattern 'sentry' -SimpleMatch -List }` — expect no output. Also 0 `.map` files under `dist/client`, so sources are never served publicly — 2f4f62a
- [x] 3.4 Typecheck passes: `npm run typecheck` — 0 errors, 0 warnings (98 files) — 2f4f62a
- [x] 3.5 Lint passes: `npm run lint` — exit 0 — 2f4f62a
- [x] 3.6 Full test suite passes: `npm test` — 14 files, 254 tests — 2f4f62a
- [x] 3.7 CI green on the branch with no Sentry credentials — PR #34; `ci` pass (2m15s), `e2e` pass (4m13s), both with no Sentry value in the environment. Note a branch push alone triggers nothing: `ci.yml:32-36` fires only on push to `main` or a PR targeting `main`, so this row needs a PR, not just a push — 2f4f62a

#### Manual

- [x] 3.8 `npm run deploy` completes and uploads source maps (was `npx wrangler deploy`; see the deviation note above). Subsumes 3.2 — debug IDs injected into 94 files (47 chunks + 47 maps) before the deploy, then uploaded; script reported "deployed, source maps uploaded". First attempt failed on an expired wrangler OAuth token and correctly aborted *before* the upload rather than shipping maps for a deploy that never happened — 2f4f62a
- [x] 3.9 Production error shows an unminified stack trace with real `src/` paths — confirmed on a `library.update.failed` event: frames resolve to `src/pages/api/library/[id].ts:100` (in `PATCH`) and `src/lib/services/library.ts:174` (in `updateLibraryEntry`), with surrounding code context. Trigger: a PATCH against `/api/library/undefined`, which Postgres rejects as `22P02 invalid input syntax for type uuid`. Not `PGRST116`, so `updateLibraryEntry` rethrows past the 404 branch into the logging catch (`services/library.ts:174`). Needs no secret change and mutates no data. Any non-`PGRST116` DB failure on that route reproduces it — 2f4f62a
- [x] 3.10 Issue's `event` tag and `userId` match the triggering call site — tag `event = library.update.failed`; `user.id = eb1ab729-3649-4099-831f-d3b25f9b312c`, the real account id from `locals.user.id`; `extra.entryId` carried; `extra.__serialized__` holds the `serializeError` output of the non-`Error` shape (`code: 22P02`, `message`, `details`, `hint`) rather than dropping it. This closes the half that 2.7 could not observe — that row's IGDB path passes no `userId`, so only these DB-failure sites can demonstrate it live — 2f4f62a
- [x] 3.11 No client JS payload regression on `/library` — confirmed against the live page. Build-side evidence backs it: an A/B build with and without `serverOnlySourcemaps()` yields a byte-identical `dist/client/_astro` (461.96 KB across the same 21 files), and no Sentry reference reaches the client at all. Structural, not incidental — the SDK is server-only and the sourcemap plugin is scoped to `isSsrBuild` — 2f4f62a
- [x] 3.12 Sentry project shows zero events from local development or CI — satisfied by restatement, because "zero from local development" was never literally true and could not be: 1.6 and 2.6 *deliberately* sent local events to verify the wiring, with the DSN temporarily in `.dev.vars`. What holds is the part that matters. **CI**: structurally impossible — no Sentry value is a repository secret and `ci.yml` consumes none, so both jobs run with `SENTRY_DSN` unset and the SDK no-ops (which is why the e2e suite's deliberate errors never reach the dashboard). **Local**: the temporary DSN has now been removed from `.dev.vars` and `.env` per the plan's closing note, so no further local events are possible; the only ones in the project are the Phase 1/2 verification events and the Phase 3 production triggers — 2f4f62a
- [x] 3.13 `SENTRY_DSN` is set as a **production Worker secret** (added during Phase 3 — the plan asserted this nowhere, and its absence is what made a fully-wired change look broken). Phase 1's 1.6/1.7 only ever exercised the DSN via `.dev.vars` locally, so production was never armed: `wrangler secret list` showed five secrets and no `SENTRY_DSN`, `withSentry` initialized with `dsn: undefined`, and every `captureException` no-op'd — indistinguishable from "no errors happened". Fixed with `wrangler secret put SENTRY_DSN` + redeploy (the redeploy re-applies `SENTRY_RELEASE`, which `--var` sets per-deploy rather than persisting in `wrangler.jsonc`). Re-check with `npx wrangler secret list` after any secret rotation or Worker recreation — 2f4f62a
- [x] 3.14 **Post-epilogue addendum — the auto-deploy path routes through the deploy script** — cf16416.
      Landed *after* the close-out epilogue (`bb40599`) and so was originally recorded nowhere; added
      here retroactively during impl review. What it fixed: Workers Builds auto-deploys every push to
      `main` and its dashboard deploy command was `npx wrangler deploy`, which skips inject+upload
      **and** drops `SENTRY_RELEASE` (a per-deploy `--var`, not a `wrangler.jsonc` binding). So every
      auto-deployed version silently reverted production to minified traces — invisible, because
      errors keep arriving, just unreadable. Everything Phase 3 verified by hand via `npm run deploy`
      would have been undone by the next push to `main`. Fix: `--skip-build` so Workers Builds can
      call the script as its deploy command without rebuilding; `WORKERS_CI_COMMIT_SHA` preferred over
      `git rev-parse HEAD`, since that checkout can be shallow or detached; and strict rejection of
      unrecognized arguments — found the hard way, `--skip-build --help` began a *real deploy* because
      an unknown flag was silently ignored. **Human gate**: the dashboard deploy command must read
      `node scripts/deploy-worker.mjs --skip-build`, with `SENTRY_ORG` / `SENTRY_PROJECT` /
      `SENTRY_AUTH_TOKEN` in its build environment. Nothing in the repo enforces this; if it reverts,
      production keeps working and keeps reporting errors, and the traces just quietly stop being
      readable.
