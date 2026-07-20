// Shared `globalThis.fetch` routing helper for the hermetic integration suites.
//
// The grounding suite (IGDB) and the route suite (IGDB + OpenRouter) both mock HTTP at the
// same edge: `globalThis.fetch`. `igdb.ts` never calls `fetch` directly — the wrapper's
// token-caching fetch (`createTokenCachingFetch`) forwards everything except the cached
// Twitch token to `globalThis.fetch`. So intercepting `globalThis.fetch` exercises the real
// wrapper query serialization while keeping the network out of the test.
//
// This helper installs a `vi.fn` over `globalThis.fetch` that routes each request to a
// caller-supplied responder keyed by a URL substring. It answers the Twitch token endpoint by
// default (every IGDB call mints a token on a cache miss), records each request so tests can
// assert on the outgoing URL / method / body, and throws a loud "unexpected fetch" for any URL
// with no registered route — a missing stub fails visibly rather than hitting the network.

import { vi } from "vitest";

/** URL fragment identifying the Twitch app-token endpoint (see `igdb-token-cache.ts`). */
const TWITCH_TOKEN_URL = "id.twitch.tv/oauth2/token";

/** A recorded outgoing fetch, exposed so tests can assert on what the code sent. */
export interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  /** Raw request body as text (JSON POSTs, apicalypse queries, form bodies), if any. */
  bodyText: string | undefined;
  init: RequestInit | undefined;
}

/**
 * What a responder may return:
 * - a full `Response` (caller controls status/headers/body), or
 * - a spec object: `json` is serialized to a 200 `application/json` body unless `status` /
 *   `body` / `headers` override it.
 */
export type RouteResult = Response | { status?: number; json?: unknown; body?: BodyInit; headers?: HeadersInit };

/** A per-URL responder: gets the recorded request, returns the response to hand back. */
export type RouteResponder = (req: RecordedRequest) => RouteResult | Promise<RouteResult>;

/** A route value: a responder function, or a static result reused for every match. */
export type Route = RouteResponder | RouteResult;

export interface FetchRouter {
  /** Every request seen by the mock, in call order — for asserting the outgoing request. */
  readonly requests: RecordedRequest[];
  /** Restore the original `globalThis.fetch`. Call in `afterEach`. */
  restore(): void;
}

/** Default Twitch token responder — a valid `{ access_token, expires_in, token_type }` body. */
function defaultTwitchToken(): RouteResult {
  return { json: { access_token: "test-twitch-token", expires_in: 3600, token_type: "bearer" } };
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function resolveMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function resolveHeaders(input: RequestInfo | URL, init: RequestInit | undefined): Headers {
  if (init?.headers) return new Headers(init.headers);
  if (input instanceof Request) return new Headers(input.headers);
  return new Headers();
}

async function resolveBodyText(input: RequestInfo | URL, init: RequestInit | undefined): Promise<string | undefined> {
  if (init?.body != null) {
    if (typeof init.body === "string") return init.body;
    // Blob / URLSearchParams / ArrayBuffer / FormData — best-effort text.
    try {
      return await new Response(init.body as BodyInit).text();
    } catch {
      return undefined;
    }
  }
  // A `Request` carries its own body; we consume the clone (the real request never goes out).
  if (input instanceof Request) {
    try {
      return await input.clone().text();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function buildResponse(result: RouteResult): Response {
  if (result instanceof Response) return result;
  const { status = 200, json, body, headers } = result;
  if (json !== undefined) {
    const merged = new Headers(headers);
    if (!merged.has("Content-Type")) merged.set("Content-Type", "application/json");
    return new Response(JSON.stringify(json), { status, headers: merged });
  }
  return new Response(body ?? null, { status, headers });
}

/**
 * Install a `globalThis.fetch` router.
 *
 * @param routes  Substring → responder (or static result). The Twitch token endpoint is
 *                answered by a default responder unless `routes` supplies its own
 *                `id.twitch.tv/oauth2/token` entry. Substrings are tested in insertion order;
 *                the first match wins.
 * @returns a {@link FetchRouter} with the recorded `requests` and a `restore()` teardown.
 */
export function installFetchRouter(routes: Record<string, Route> = {}): FetchRouter {
  const originalFetch = globalThis.fetch;
  const requests: RecordedRequest[] = [];

  // Default Twitch token route, overridable by a caller-supplied match.
  const table: Record<string, Route> = { [TWITCH_TOKEN_URL]: defaultTwitchToken, ...routes };
  const matchers = Object.keys(table);

  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveUrl(input);
    const req: RecordedRequest = {
      url,
      method: resolveMethod(input, init),
      headers: resolveHeaders(input, init),
      bodyText: await resolveBodyText(input, init),
      init,
    };
    requests.push(req);

    const key = matchers.find((fragment) => url.includes(fragment));
    if (key === undefined) {
      throw new Error(
        `Unexpected fetch to ${url} — no route registered. Add a matching substring to installFetchRouter().`,
      );
    }

    const route = table[key];
    const result = typeof route === "function" ? await route(req) : route;
    return buildResponse(result);
  });

  globalThis.fetch = mock;

  return {
    requests,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}
