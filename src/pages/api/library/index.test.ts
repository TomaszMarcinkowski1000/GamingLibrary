import type { Game } from "@api-wrappers/igdb-wrapper";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FetchRouter, type Route, type RouteResult, installFetchRouter } from "@test/helpers/fetch-mock";
import { insertClient } from "@test/helpers/supabase-mock";
import { lookupRequestSchema } from "@/lib/validation/library";

// Contract tests for `POST /api/library` — the create half of Risk #6, and the only layer that can
// reach `createEntrySchema` (defined inline and unexported at `index.ts:14-17`).
//
// WHAT THIS FILE OWNS: which request shapes become a 400 and which field the message names; that a
// valid create forwards the request-scoped KV and returns 201 with the inserted row; **what the
// route actually persists**; that an IGDB failure never costs the user their input; and which of the
// two guards fires first. Supabase is stubbed at `@/lib/supabase`; everything else — the real
// `createLibraryEntry`, the real `lookupGameMetadata`, the real wrapper query serialization — runs,
// with only `globalThis.fetch` mocked at the provider edge.
//
// WHAT IT DELIBERATELY DOES NOT OWN: grounding correctness. Edition collapse, the confidence gate,
// the field map and the `no_match` degradation are `src/lib/services/igdb.integration.test.ts`'s,
// and nothing here re-asserts them — the one grounded fixture below exists to make the *persisted
// payload* observable, not to re-prove the match.
//
// Like `[id].test.ts`, this suite proves contract translation, never ownership: the insert carries
// no `user_id` at all (the column defaults to `auth.uid()`), so cross-user isolation is proven one
// layer down in `supabase/tests/database/library_entries_rls.test.sql` (`npm run test:db`).
//
// Assertions read the OUTGOING call — the captured insert payload, the recorded IGDB requests, the
// KV read counter — not only the status code, per Phase 1's impl-review (F2).

// `cloudflare:workers` is a Worker-runtime virtual module and does not exist under vitest, so the
// whole file mocks it (a `vi.mock` factory is hoisted per *file*; it cannot be scoped to a test).
// `IGDB_TOKENS` is exposed as a COUNTING GETTER rather than a plain `{}` for two reasons:
//   1. `{}`-shaped KV means `kv.get`/`kv.put` are undefined, so the token cache misses and mints —
//      which the router answers with the default Twitch token (mirrors `identify.test.ts:25`).
//   2. The counter is how the 400/401 tests prove they never reach the IGDB edge. The plan asked
//      for those tests to run "without the KV mock"; that is not expressible per-test, so the
//      equivalent — and stronger — claim is asserted directly: `env.IGDB_TOKENS` was never read,
//      and no fetch router is installed, so `test/setup/no-network.ts` would reject any request.
const kv = vi.hoisted(() => ({ reads: 0 }));
vi.mock("cloudflare:workers", () => ({
  env: {
    get IGDB_TOKENS() {
      kv.reads += 1;
      return {};
    },
  },
}));

// Inject Supabase by mocking `createClient`: a hoisted holder lets each test swap in a fresh
// capturing stub — or `null`, which is what the route sees when `SUPABASE_*` is unset.
const holder = vi.hoisted((): { supabaseClient: unknown } => ({ supabaseClient: null }));
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => holder.supabaseClient) }));

import { POST } from "./index";

/** Build a `Game`-shaped fixture with only the fields the lookup reads (mirrors `igdb.test.ts`). */
function game(props: Partial<Game> & { id: number; name: string }): Game {
  return { slug: props.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), ...props };
}
const platforms = (...names: string[]) => names.map((name) => ({ name })) as Game["platforms"];

/** A base-game candidate that grounds confidently for "Alan Wake II" on PlayStation 5 (id 100). */
function alanWakeMatch(): Game[] {
  return [game({ id: 100, name: "Alan Wake II", platforms: platforms("PlayStation 5"), total_rating_count: 200 })];
}

let router: FetchRouter | undefined;

/** Install the provider fetch edge: the default Twitch token, the IGDB candidates, and the length. */
function mockProviders(opts: { games?: Game[] | RouteResult; length?: number } = {}): FetchRouter {
  const routes: Record<string, Route> = {};
  if (opts.games !== undefined) routes["/v4/games"] = Array.isArray(opts.games) ? { json: opts.games } : opts.games;
  routes["/v4/game_time_to_beats"] = {
    json: opts.length === undefined ? [] : [{ normally: opts.length, game_id: 0 }],
  };
  router = installFetchRouter(routes);
  return router;
}

/** Construct the `APIContext` the POST handler destructures (`request`, `cookies`, `locals`). */
function context(opts: { body?: unknown; rawBody?: string; user?: unknown } = {}) {
  const { user = { id: "user-1" } } = opts;
  const init: RequestInit = { method: "POST" };
  if (opts.rawBody !== undefined) {
    init.body = opts.rawBody;
  } else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { "Content-Type": "application/json" };
  }
  const request = new Request("https://test.local/api/library", init);
  return { request, cookies: {} as never, locals: { user } } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  holder.supabaseClient = null;
  kv.reads = 0;
});

afterEach(() => {
  router?.restore();
  router = undefined;
});

describe("POST /api/library — createEntrySchema boundaries", () => {
  // NOTE: no `mockProviders()` in this block, on purpose. The suite-wide deny-all fetch
  // (`test/setup/no-network.ts`) rejects every request, so a validation-ordering change that let a
  // rejected body reach IGDB would fail loudly here rather than pass quietly.
  const REJECTED = [
    { name: "an empty body", body: {} },
    { name: "a whitespace-only title", body: { title: "   ", platform: "PlayStation 5" } },
    { name: "a whitespace-only platform", body: { title: "Hollow Knight", platform: " " } },
    { name: "a missing platform", body: { title: "Hollow Knight" } },
    { name: "a missing title", body: { platform: "Switch" } },
  ];

  it.each(REJECTED)("400s on $name without reaching IGDB or the database", async ({ body }) => {
    const { client, insert } = insertClient();
    holder.supabaseClient = client;

    const res = await POST(context({ body }));

    expect(res.status).toBe(400);
    // The outgoing side, not just the status: nothing was written, and the request-scoped KV was
    // never even read — so the handler provably short-circuited before `createLibraryEntry`.
    expect(insert).not.toHaveBeenCalled();
    expect(kv.reads).toBe(0);
  });

  it("names the offending field in the 400 message, so the add form can point at it", async () => {
    // The user-visible half of the contract: which field failed, not merely that something did.
    // Matched loosely (`/title/i`) rather than pinned to the literal, so rewording the message is
    // not a false failure — only losing the field attribution is.
    const { client } = insertClient();
    holder.supabaseClient = client;

    const titleRes = await POST(context({ body: { title: "  ", platform: "PlayStation 5" } }));
    const platformRes = await POST(context({ body: { title: "Hollow Knight", platform: "  " } }));

    await expect(titleRes.json()).resolves.toMatchObject({ error: expect.stringMatching(/title/i) as unknown });
    await expect(platformRes.json()).resolves.toMatchObject({ error: expect.stringMatching(/platform/i) as unknown });
  });

  it("keeps the inline create contract in lockstep with `lookupRequestSchema`, which it duplicates", async () => {
    // `createEntrySchema` (`index.ts:14-17`) and `lookupRequestSchema` (`validation/library.ts:79-82`)
    // are the same contract written twice, and nothing imports one from the other — so they can
    // drift silently, and a body the lookup endpoint accepts would then be refused on save (or the
    // reverse). Asserted as agreement between the two layers, not by copying either one's rules.
    mockProviders({ games: [] });
    const { client } = insertClient();
    holder.supabaseClient = client;

    const cases: unknown[] = [...REJECTED.map((c) => c.body), { title: "Hollow Knight", platform: "Switch" }];
    for (const body of cases) {
      const res = await POST(context({ body }));
      const rejectedByLookup = !lookupRequestSchema.safeParse(body).success;
      expect({ body, routeRejects: res.status === 400 }).toEqual({ body, routeRejects: rejectedByLookup });
    }
  });
});

describe("POST /api/library — the enriched 201, and what it persists", () => {
  it("201s with the inserted row, forwarding the request-scoped KV to the enrichment lookup", async () => {
    const { client, insert, payload } = insertClient();
    holder.supabaseClient = client;
    const r = mockProviders({ games: alanWakeMatch(), length: 36000 });

    const res = await POST(context({ body: { title: "Alan Wake II", platform: "PlayStation 5" } }));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ entry: { id: "row-1", title: "Alan Wake II" } });
    // `env.IGDB_TOKENS` really flowed into the service: without the forward, the token-caching fetch
    // binds to nothing and the whole enrichment path degrades to `no_match` while still answering 201.
    expect(kv.reads).toBe(1);
    expect(r.requests.some((req) => req.url.includes("id.twitch.tv/oauth2/token"))).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    // Shape, not presence: a ground-miss also writes a row, so `matched` + the base id is what
    // distinguishes a real enrichment from a degraded save.
    expect(payload()).toMatchObject({ igdb_id: 100, metadata_status: "matched", length_hours: 10 });
  });

  it("documentation-of-behaviour: persists the user's platform string VERBATIM, un-normalized", async () => {
    // A BEHAVIOUR RECORD, NOT A REQUIREMENT. The photo path normalizes ("ps5" → "PlayStation 5");
    // this one does not, because `vision.ts:137-138` are the only production call sites of the
    // normalizers. The asymmetry is deliberate — the manual path was explicitly excluded from the
    // change that introduced them
    // (`context/archive/2026-06-19-normalize-photo-platform-title/plan.md:61-63`, "Not touching the
    // manual-add path (`createLibraryEntry`)"). No PRD oracle exists either way: "normalize"/"alias"
    // never appear in `prd.md` in a platform context.
    //
    // So the two write paths store two different strings for one console, and `library.ts:269`'s
    // exact-match `.in()` platform filter keeps them as two filter buckets. Asserting
    // "PlayStation 5" here would be asserting an unbuilt feature and would fail against correct
    // code. If this test goes red because the manual path was normalized on purpose, it is a
    // decision to re-take — delete the record — not a regression to revert.
    const { client, payload } = insertClient();
    holder.supabaseClient = client;
    mockProviders({ games: alanWakeMatch(), length: 36000 });

    await POST(context({ body: { title: "Alan Wake II", platform: "ps5" } }));

    // Grounding still resolves "ps5" to IGDB platform 167, so the entry matches — it is only the
    // *stored* string that stays as typed.
    expect(payload()).toMatchObject({ platform: "ps5", igdb_id: 100, metadata_status: "matched" });
    expect(payload()?.platform).not.toBe("PlayStation 5");
  });
});

describe("POST /api/library — enrichment failure does not cost the user their input", () => {
  it("still 201s when IGDB fails, persisting the typed fields with metadata_status='no_match'", async () => {
    // The promise `index.ts:20-25` makes: a flaky external API must never turn into a failed save.
    // Asserted on the persisted *shape* — `no_match` + a null id — rather than on "an insert ran",
    // which would pass equally for a correct save and for an un-grounded guess.
    const { client, payload } = insertClient();
    holder.supabaseClient = client;
    const r = mockProviders({ games: { status: 500, body: "igdb upstream boom" } });

    const res = await POST(context({ body: { title: "Alan Wake II", platform: "PlayStation 5" } }));

    expect(res.status).toBe(201);
    // Pin that the fold followed a real upstream failure, not a never-attempted lookup: both read
    // identically from the response alone.
    expect(r.requests.some((req) => req.url.includes("/v4/games"))).toBe(true);
    expect(payload()).toMatchObject({
      title: "Alan Wake II",
      platform: "PlayStation 5",
      igdb_id: null,
      metadata_status: "no_match",
    });
  });
});

describe("POST /api/library — guards, both faces", () => {
  // Same pair of faces as `[id].test.ts`, asserted here to confirm the ordering is consistent across
  // all four library handlers. `if (!supabase)` runs BEFORE `if (!locals.user)` and the vitest env
  // stub leaves `SUPABASE_*` undefined on purpose, so a 401 assertion written without the
  // `@/lib/supabase` mock above would hit the 500 branch and prove nothing about auth.
  it("401s when unauthenticated, before touching IGDB or the database", async () => {
    const { client, insert } = insertClient();
    holder.supabaseClient = client;

    const res = await POST(context({ body: { title: "Alan Wake II", platform: "PlayStation 5" }, user: null }));

    expect(res.status).toBe(401);
    expect(insert).not.toHaveBeenCalled();
    expect(kv.reads).toBe(0);
  });

  it("documentation-of-behaviour: 500s with a config message when Supabase is unconfigured, even unauthenticated", async () => {
    // The config guard runs first, so an anonymous caller against a misconfigured deploy learns
    // "Supabase is not configured" instead of "Not authenticated". `prd.md:188` describes the route
    // surface as auth-gated, so the two are in tension — recorded, not fixed (plan.md "What We're
    // NOT Doing"). Red here means the guards were reordered: a decision to re-take, not a revert.
    holder.supabaseClient = null;

    const res = await POST(context({ body: { title: "Alan Wake II", platform: "PlayStation 5" }, user: null }));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Supabase is not configured" });
  });
});
