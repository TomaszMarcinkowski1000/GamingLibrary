import { describe, expect, it, vi } from "vitest";

/**
 * The privacy claims in `sentry.server.config.ts` were, until this file existed, comments only —
 * which is how two of them came to be wrong at once (impl review F1/F2). The failure mode is
 * specific and silent: a wrong option here does not throw, does not fail a build, and shows up only
 * as user data already sitting in a third-party dashboard. So these assertions exist to fail *at
 * `npm test`*, not to document.
 *
 * What is mocked and why:
 *
 * - `withSentry` is replaced with a recorder, because the options are otherwise sealed inside a
 *   callback the Worker runtime invokes with a live `env`. Everything else from
 *   `@sentry/cloudflare` is the real module (`importOriginal`) — in particular the real
 *   `httpServerIntegration`, since asserting against a fake of it would prove nothing.
 * - The Astro adapter entrypoint is stubbed. It is a build artifact of `@astrojs/cloudflare`, not
 *   something under test, and it does not import cleanly outside a Workers build.
 */

const withSentry = vi.fn((optionsFor: unknown, handler: unknown) => ({ optionsFor, handler }));

vi.mock("@sentry/cloudflare", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sentry/cloudflare")>()),
  withSentry,
}));

vi.mock("@astrojs/cloudflare/entrypoints/server", () => ({ default: { fetch: vi.fn() } }));

await import("./sentry.server.config");

/** The options callback handed to `withSentry`, invoked with a caller-supplied `env`. */
function optionsFor(env: Record<string, string | undefined>) {
  expect(withSentry).toHaveBeenCalledTimes(1);
  const build = withSentry.mock.calls[0][0] as (env: unknown) => Record<string, unknown>;
  return build(env);
}

const PRODUCTION_ENV = { SENTRY_DSN: "https://key@o0.ingest.sentry.io/0", SENTRY_RELEASE: "a".repeat(40) };

describe("Sentry Worker options — request bodies", () => {
  /**
   * The one assertion that actually stops a plaintext password reaching Sentry. `dataCollection`
   * does *not* do this: `captureIncomingRequestBody` gates solely on this integration's
   * `maxRequestBodySize === "none"`, and `requestDataIntegration` then attaches whatever reached
   * the scope regardless. Auth POSTs are urlencoded, a textual content type, so anything less than
   * "none" ships `email=…&password=…` on any event raised during a sign-in.
   */
  it("registers httpServerIntegration with body capture fully off", () => {
    const integrations = optionsFor(PRODUCTION_ENV).integrations as { name: string; maxRequestBodySize?: string }[];

    const httpServer = integrations.find((integration) => integration.name === "HttpServer");

    expect(httpServer, "no HttpServer integration — incoming request bodies are being captured").toBeDefined();
    expect(httpServer?.maxRequestBodySize).toBe("none");
  });
});

describe("Sentry Worker options — dataCollection", () => {
  /**
   * Not a restatement of the literal object: it guards the resolution rule that made F2 possible.
   * `resolveDataCollectionOptions` picks its base as
   * `dataCollection != null ? DEFAULTS : profileFor(sendDefaultPii)`, so supplying the object at all
   * makes every *unnamed* field permissive. Omitting one does not inherit "off" — it inherits "on".
   * Hence: assert on the key set, so deleting a line fails here rather than silently opting in.
   */
  it("names every field that would otherwise fall back to the permissive base", () => {
    const dataCollection = optionsFor(PRODUCTION_ENV).dataCollection as Record<string, unknown>;

    expect(Object.keys(dataCollection).sort()).toEqual([
      "cookies",
      "databaseQueryData",
      "genAI",
      "httpBodies",
      "httpHeaders",
      "urlQueryParams",
      "userInfo",
    ]);
  });

  it("sets every one of them to its non-collecting value", () => {
    expect(optionsFor(PRODUCTION_ENV).dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
    });
  });
});

describe("Sentry Worker options — environment and quota", () => {
  it("tags a deployed Worker as production", () => {
    expect(optionsFor(PRODUCTION_ENV).environment).toBe("production");
  });

  /**
   * `SENTRY_RELEASE` is set only by `scripts/deploy-worker.mjs`, so its absence means a developer
   * running locally with a DSN pasted into `.dev.vars` — those events must not land in the same
   * stream as real incidents.
   */
  it("tags a local run with a pasted DSN as development, not production", () => {
    expect(optionsFor({ SENTRY_DSN: PRODUCTION_ENV.SENTRY_DSN }).environment).toBe("development");
  });

  it("sends no performance spans", () => {
    expect(optionsFor(PRODUCTION_ENV).tracesSampleRate).toBe(0);
  });

  /** An unset DSN is the intended local/CI configuration: the SDK never initializes and every
   * `captureException` degrades to a no-op. Locked so nobody "fixes" it into a required value. */
  it("passes the DSN straight through, including when it is unset", () => {
    expect(optionsFor(PRODUCTION_ENV).dsn).toBe(PRODUCTION_ENV.SENTRY_DSN);
    expect(optionsFor({}).dsn).toBeUndefined();
  });
});
