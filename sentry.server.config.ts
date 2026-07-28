/**
 * Worker entrypoint — the one and only place in this app that reads a Sentry DSN.
 *
 * `wrangler.jsonc`'s `main` points here rather than straight at
 * `@astrojs/cloudflare/entrypoints/server`; this module re-exports that same adapter handler,
 * wrapped in `Sentry.withSentry` so an *unhandled* throw anywhere in the SSR path becomes a Sentry
 * issue. Failures that someone already caught take the other route — `logError` in
 * `src/lib/logger.ts`. The two are complementary, not redundant.
 *
 * An unset `SENTRY_DSN` is the intended local and CI configuration, not a misconfiguration: with no
 * DSN the SDK never initializes and every `captureException` in the app degrades to a no-op, which
 * is what keeps development and the e2e suite (which deliberately triggers errors) off the
 * dashboard. Do not "fix" this by making the DSN required. Production gets it via
 * `npx wrangler secret put SENTRY_DSN`.
 *
 * `withSentry` scopes the client to the in-flight request through AsyncLocalStorage, which is what
 * lets `logger.ts` call a bare `captureException` without threading a client through every call
 * site. That depends on the `nodejs_compat` compatibility flag in `wrangler.jsonc`: drop it and
 * handled errors silently stop reaching Sentry while unhandled ones keep working.
 */
import handler from "@astrojs/cloudflare/entrypoints/server";
import * as Sentry from "@sentry/cloudflare";

/**
 * `Env` comes from `worker-configuration.d.ts` (`npm run cf-typegen`), which types the declared
 * bindings; a secret set with `wrangler secret put` is not part of it, hence the widening.
 */
type WorkerEnv = Env & { SENTRY_DSN?: string; SENTRY_RELEASE?: string };

export default Sentry.withSentry<WorkerEnv>(
  (env) => ({
    dsn: env.SENTRY_DSN,
    // The deployed commit, set as a plain Worker var by `npm run deploy` (scripts/deploy-worker.mjs)
    // and matched against the source maps that deploy uploaded — this is what makes a production
    // stack trace resolve to real `src/` lines. Unset in dev, which just means untagged events.
    release: env.SENTRY_RELEASE,
    // Errors only. The free plan's span quota is far tighter than its error quota, and nothing
    // here needs latency data on the IGDB / OpenRouter calls.
    tracesSampleRate: 0,
    // Load-bearing, not cosmetic: `POST /api/identify` bodies carry base64 shelf photos, which
    // automatic body collection would ship to a third party. The one piece of user data we do
    // want — `userId` — gets attached explicitly by `logError`.
    dataCollection: { userInfo: false, httpBodies: [] },
    environment: "production",
  }),
  handler,
);
