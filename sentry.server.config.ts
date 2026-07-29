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
    // The only switch that actually stops incoming request bodies reaching Sentry.
    // `dataCollection.httpBodies` does *not* do this on the Cloudflare path:
    // `captureIncomingRequestBody` gates solely on `maxRequestBodySize === "none"`, and
    // `requestDataIntegration` then attaches whatever landed on the scope unconditionally.
    // Passing the integration by name here replaces the default instance.
    //
    // What this protects: `POST /api/auth/sign{in,up}` are native `<form method="POST">`, i.e.
    // `application/x-www-form-urlencoded` — a textual content type — so without this, any event
    // raised during a sign-in carries `email=…&password=<plaintext>`. `/api/library` JSON bodies
    // are captured the same way. `POST /api/identify`'s base64 shelf photos are `multipart/form-data`
    // and were already skipped by content type, not by this setting.
    //
    // The one piece of user data we do want — `userId` — gets attached explicitly by `logError`.
    integrations: [Sentry.httpServerIntegration({ maxRequestBodySize: "none" })],
    // Every field is named on purpose. `resolveDataCollectionOptions` picks its base as
    // `dataCollection != null ? DEFAULTS : profileFor(sendDefaultPii)` — so supplying this object
    // *at all* swaps the restrictive no-PII profile for the fully-permissive `DEFAULTS` on every
    // field left unnamed. Omitting one here does not inherit "off"; it inherits "on".
    //
    // `httpBodies: []` is kept as a deny-by-default for any code path that does consult it; it is
    // the integration above, not this line, that does the work on incoming requests.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
    },
    // Derived, not hardcoded: `SENTRY_RELEASE` is set only by `scripts/deploy-worker.mjs`, so its
    // presence *is* "this is a deployed Worker". A developer following `.dev.vars.example` and
    // pasting a DSN in to verify the wiring therefore tags those events `development` instead of
    // dropping them into the same stream as real production incidents.
    environment: env.SENTRY_RELEASE ? "production" : "development",
  }),
  handler,
);
