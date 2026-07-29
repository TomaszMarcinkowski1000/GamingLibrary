# Sentry Error Monitoring — Plan Brief

> Full plan: `context/changes/sentry-error-monitoring/plan.md`

## What & Why

Wire Sentry as the production error-monitoring sink. Today every handled failure in the app produces a
JSON line on `console.error` that lands in Cloudflare Workers Logs — queryable, but only if someone
thinks to go look. Nothing pages anyone, and unhandled throws at the Worker boundary aren't captured
in a groupable form at all. Sentry closes both gaps.

## Starting Point

The seam already exists. The preceding `error-propagation-observability` change (commit `f5b95e7`)
built `src/lib/logger.ts` as the single place a handled failure becomes observable, and its header
comment names Sentry explicitly: _"one `captureException` call here, not one per `catch`."_ 26 call
sites across 10 files route through `logError` / `logWarning`, using stable dot-namespaced event names
chosen for exactly this kind of grouping. What's missing is the sink itself, and a wrapper at the
Worker entrypoint for the throws nobody caught.

## Desired End State

A production error appears in Sentry within seconds, grouped by its `event` name, carrying the affected
`userId` and the call site's structured fields, with a readable un-minified stack trace. Local
development and CI are untouched: no DSN, no events, no build-time dependency on a Sentry account.
Cloudflare Workers Logs keeps working exactly as before — Sentry is additive.

## Key Decisions Made

| Decision              | Choice                                    | Why                                                                                                  |
| --------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Runtime scope         | Server only                               | Covers every path already funnelling through `logError` at zero client-bundle cost and no browser PII. |
| What forwards         | `logError` → `captureException` only      | `logWarning` fires on any malformed POST (bots included) and would flood the free-plan quota.           |
| Hook points           | Worker entrypoint **and** `logger.ts`      | `withSentry` catches unhandled throws; `logError` catches handled ones. They're complementary.          |
| PII                   | `userId` only, auto-collection off        | `POST /api/identify` bodies carry base64 user photos — automatic body capture would ship them.          |
| Env gating            | Production only                           | The e2e suite deliberately triggers errors; those must not reach the dashboard or burn quota.           |
| Tracing               | Errors only (`tracesSampleRate: 0`)       | Matches what the change asks for; the free plan's span quota is far tighter than its error quota.       |
| Source maps           | Yes, via the `@sentry/astro` integration  | Without them the first real production trace points into minified Worker output and is near-useless.    |
| Testing               | Unit test with a mocked SDK               | `lint-staged` runs it whenever `logger.ts` is staged, so a refactor can't quietly drop the capture.     |
| Credential ownership  | Human creates the project, plan pauses    | No credential passes through the implementing agent.                                                    |

## Scope

**In scope:** `@sentry/cloudflare` at the Worker entrypoint; one `captureException` in `logger.ts`;
`SENTRY_DSN` as a prod-only Worker secret; source-map upload; a new `src/lib/logger.test.ts`; docs in
`.env.example`.

**Out of scope:** browser SDK, Session Replay, performance tracing, Sentry Logs stream, `logWarning`
forwarding, any change to a `catch` block, alerting rules, dashboards, release tracking, a CI deploy
workflow.

## Architecture / Approach

```
unhandled throw ──────────────┐
                              ├──> sentry.server.config.ts (withSentry, reads env.SENTRY_DSN)
Astro SSR handler ────────────┘         │
                                        │ AsyncLocalStorage request scope
catch → logError(event, err, fields) ───┴──> Sentry.captureException  ──> Sentry
                    └──> console.error(JSON)  ──────────────────────────> Cloudflare Workers Logs
```

The entrypoint is a new root-level `sentry.server.config.ts` that wraps
`@astrojs/cloudflare/entrypoints/server`; `wrangler.jsonc`'s `main` repoints at it. Because
`withSentry` scopes the client per-request via AsyncLocalStorage (enabled by the already-present
`nodejs_compat` flag), `logger.ts` needs no DSN handling and no env access at all — and
`captureException` simply no-ops wherever the SDK was never initialized.

## Phases at a Glance

| Phase                                | What it delivers                                                        | Key risk                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1. Entrypoint wiring                 | Unhandled Worker throws reach Sentry; DSN is prod-only                  | Repointing `wrangler.jsonc` `main` is the one change that could break deploy         |
| 2. Logger → `captureException`       | All 26 handled call sites report, guarded by a contract test            | A throwing SDK must not cost the app its existing console log line                   |
| 3. Source maps + prod verification   | Readable stack traces; proof no Sentry code reached the client bundle   | Introduces the only build-time credential; must not break credential-free CI builds  |

**Prerequisites:** a free-plan Sentry account (JavaScript → Cloudflare platform, **not** the wizard —
it targets the Node/Astro path and writes a conflicting config), plus Cloudflare deploy access for
`wrangler secret put`.

**Estimated effort:** ~1-2 sessions across 3 phases, with a human pause after phases 1 and 2.

## Open Risks & Assumptions

- **The `@sentry/astro` integration can inject client-side instrumentation.** Phase 3 treats "no Sentry
  code in `dist/_astro/`" as an explicit verification step rather than an assumption, so a silent
  regression here fails the phase instead of shipping ~30-40kB to every page.
- **CI builds run with no Sentry credentials.** The plan asserts `npm run build` passes both with and
  without `SENTRY_AUTH_TOKEN`; a missing token must warn and skip, never fail.
- **`nodejs_compat` is load-bearing.** If a future change drops that flag, handled errors silently stop
  reaching Sentry while unhandled ones keep working — a partial failure that's easy to misread.
- **Deploy is manual.** Source-map upload runs on the deploying developer's machine, so a colleague
  deploying without the auth token gets minified traces for that release.

## Success Criteria (Summary)

- A deliberately triggered production error appears in Sentry with a readable stack trace, its `event`
  tag, and the affected `userId`.
- Degraded-success behavior is unchanged — a flaky IGDB lookup still costs the user nothing.
- The Sentry project shows zero events from local development or CI, and every gate
  (`npm test`, `lint`, `typecheck`, `build`) passes on a machine with no Sentry credentials.
