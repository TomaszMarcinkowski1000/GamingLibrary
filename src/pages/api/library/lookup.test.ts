import type { Game } from "@api-wrappers/igdb-wrapper";
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FetchRouter, type Route, type RouteResult, installFetchRouter } from "@test/helpers/fetch-mock";

// Contract tests for `POST /api/library/lookup` — the "Re-fetch metadata" button's only backend.
//
// WHAT THIS FILE OWNS: the distinction this route exists to preserve — "IGDB has no such game"
// versus "we never reached IGDB". The route used to fold both into `{ status: 'no_match' }`, which
// made an outage indistinguishable from an honest miss *in the response itself*: the dialog told the
// user their game wasn't in IGDB and they hand-filled metadata a retry would have populated. These
// tests pin the split at the status-code level, because that is the only part of it the caller can
// see. The GameDialog half (which message each outcome renders) is the island's, not this file's.
//
// WHAT IT DELIBERATELY DOES NOT OWN: grounding correctness — edition collapse, the confidence gate,
// the field map — all of which live in `src/lib/services/igdb.integration.test.ts`. The fixtures here
// are the two coarsest possible outcomes, chosen only to make the route's *translation* observable.
//
// Mocking mirrors `index.test.ts`: `cloudflare:workers` is a Worker-runtime virtual module absent
// under vitest, and only `globalThis.fetch` is stubbed, so the real `lookupGameMetadata` and the real
// wrapper query serialization run. This route touches neither Supabase nor the database.
//
// `IGDB_TOKENS` is a WORKING KV stub (always-miss read, no-op write), not the `{}` the sibling
// suites use. `{}` means `kv.get`/`kv.put` are undefined, and the token cache — correctly — logs
// each of those TypeErrors as its own failure. Since this suite asserts on *which* failures were
// recorded, that infrastructure noise would drown the signal.
vi.mock("cloudflare:workers", () => ({
  env: { IGDB_TOKENS: { get: () => Promise.resolve(null), put: () => Promise.resolve(undefined) } },
}));

import { POST } from "./lookup";

const platforms = (...names: string[]) => names.map((name) => ({ name })) as Game["platforms"];

let router: FetchRouter | undefined;
// The route logs the upstream failure server-side (`@/lib/logger`); keep test output clean while
// still proving the log happened — an unlogged swallow is exactly the defect this suite guards.
let errorSpy: MockInstance<typeof console.error>;

/** Install the IGDB edge: the default Twitch token plus the two endpoints a lookup touches. */
function mockIgdb(games: Game[] | RouteResult): FetchRouter {
  const routes: Record<string, Route> = {
    "/v4/games": Array.isArray(games) ? { json: games } : games,
    "/v4/game_time_to_beats": { json: [] },
  };
  router = installFetchRouter(routes);
  return router;
}

/** Construct the `APIContext` the POST handler destructures (`request`, `locals`). */
function context(opts: { body?: unknown; user?: unknown } = {}) {
  const { user = { id: "user-1" } } = opts;
  const request = new Request("https://test.local/api/library/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts.body ?? { title: "Alan Wake II", platform: "PlayStation 5" }),
  });
  return { request, locals: { user } } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  router?.restore();
  router = undefined;
  errorSpy.mockRestore();
});

describe("POST /api/library/lookup — an outage is not an answer about the game", () => {
  it("502s when IGDB is unreachable, instead of claiming no_match", async () => {
    // The regression this suite exists for. A 200 + `{ status: 'no_match' }` here is a lie the UI
    // cannot see through: it reads identically to a genuine miss (asserted in the next test).
    const r = mockIgdb({ status: 500, body: "igdb upstream boom" });

    const res = await POST(context());

    expect(res.status).toBe(502);
    // Pin that the 502 followed a real upstream attempt, not a short-circuit before the edge —
    // both would produce the same status.
    expect(r.requests.some((req) => req.url.includes("/v4/games"))).toBe(true);
  });

  it("records the cause server-side, since the client is told status-only", async () => {
    // The response body is deliberately vague (the thrown message can carry IGDB/Twitch auth
    // detail), which makes the log the ONLY surviving record of why the lookup failed.
    mockIgdb({ status: 500, body: "igdb upstream boom" });

    const res = await POST(context());
    const body = await res.json<{ error: string }>();

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(String(errorSpy.mock.calls[0][0])).toContain("library.lookup.igdb_unavailable");
    // ...and that vagueness is itself the contract: no upstream detail reaches the caller.
    expect(body.error).not.toContain("igdb upstream boom");
  });

  it("still answers 200 + no_match when IGDB simply has nothing", async () => {
    // The other side of the split. Without this, "502 on failure" could be satisfied by a route
    // that 502s on every miss too — which would push the dialog into an endless retry loop.
    mockIgdb([]);

    const res = await POST(context({ body: { title: "Definitely Not A Real Game", platform: "Evercade" } }));
    const body = await res.json<{ result: { status: string } }>();

    expect(res.status).toBe(200);
    expect(body.result.status).toBe("no_match");
    // A genuine miss is an ordinary outcome, not an incident — it must not page anyone.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("returns the grounded metadata on a match, unchanged by the error-path split", async () => {
    mockIgdb([{ id: 100, name: "Alan Wake II", slug: "alan-wake-ii", platforms: platforms("PlayStation 5") }]);

    const res = await POST(context());
    const body = await res.json<{ result: { status: string; igdbId?: number } }>();

    expect(res.status).toBe(200);
    expect(body.result).toMatchObject({ status: "matched", igdbId: 100 });
  });
});

describe("POST /api/library/lookup — guards", () => {
  it("401s when unauthenticated, without touching IGDB", async () => {
    // No fetch router installed: the suite-wide deny-all (`test/setup/no-network.ts`) would reject
    // any request, so reaching the provider edge fails loudly rather than passing quietly.
    const res = await POST(context({ user: null }));

    expect(res.status).toBe(401);
  });

  it("400s on a blank title without reaching IGDB", async () => {
    const res = await POST(context({ body: { title: "   ", platform: "PlayStation 5" } }));

    expect(res.status).toBe(400);
  });
});
