import type { Game } from "@api-wrappers/igdb-wrapper";
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FetchRouter, type Route, type RouteResult, installFetchRouter } from "@test/helpers/fetch-mock";
import { insertClient } from "@test/helpers/supabase-mock";

// Hermetic integration tests for `POST/GET /api/identify`, the orchestration/abstain core of Risk #2.
//
// The route runs end-to-end: OpenRouter (vision) and IGDB (grounding) are mocked only at the
// `globalThis.fetch` edge; the *real* `vision.ts` normalizers and the *real* internal grounding
// (`lookupGameMetadata`/`collapseToBaseGame`/`isConfidentMatch`) run unmocked — they are the seam
// under test. Supabase is the one injected stub: `@/lib/supabase`'s `createClient` returns a
// capturing insert client, so the persist path never needs `SUPABASE_*` env and we can read the
// exact payload that would be written.
//
// The oracle is FR-006/US-01 (a vision abstain routes to manual entry, no save) and the by-design
// save asymmetry (a confident vision read that ground-misses still saves with
// `metadata_status='no_match'`) — NOT any value copied out of `identify.ts`. Save faces are asserted
// on the captured payload's *shape* (`metadata_status`/`igdb_id`), never on mere insert invocation,
// because a confident ground-miss also writes a row.

// `cloudflare:workers` is a Worker-runtime virtual module (the route reads the request-scoped KV via
// `env.IGDB_TOKENS`). Under vitest it doesn't exist, so mock it to a `{}`-shaped KV: `kv.get`/`kv.put`
// are undefined, forcing the token-caching fetch to miss and mint — which the router answers with the
// default Twitch token (mirrors the grounding suite's `stubKv`).
vi.mock("cloudflare:workers", () => ({ env: { IGDB_TOKENS: {} } }));

// Inject Supabase by mocking `createClient` — the persist path calls it and we hand back a capturing
// stub. A hoisted holder lets each test swap in a fresh capture client before invoking the route.
const holder = vi.hoisted((): { supabaseClient: unknown } => ({ supabaseClient: null }));
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => holder.supabaseClient) }));

import { GET, POST } from "./identify";
import { createClient } from "@/lib/supabase";

const mockCreateClient = vi.mocked(createClient);

/** Build a `Game`-shaped fixture with only the fields the lookup reads (mirrors `igdb.test.ts`). */
function game(props: Partial<Game> & { id: number; name: string }): Game {
  return { slug: props.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), ...props };
}
const platforms = (...names: string[]) => names.map((name) => ({ name })) as Game["platforms"];

/** OpenRouter chat-completion envelope carrying the model's structured `content` (a JSON string). */
function visionEnvelope(read: { title: string; platform: string; confidence: number } | string): RouteResult {
  const content = typeof read === "string" ? read : JSON.stringify(read);
  return { json: { choices: [{ message: { content } }] } };
}

let router: FetchRouter | undefined;

/**
 * Install the provider fetch edge: the default Twitch token, plus (when supplied) the OpenRouter
 * vision envelope, the IGDB `/v4/games` candidates, and the `/v4/game_time_to_beats` length.
 */
function mockProviders(opts: { vision?: RouteResult; games?: Game[] | RouteResult; length?: number }): FetchRouter {
  const routes: Record<string, Route> = {};
  if (opts.vision !== undefined) routes["openrouter.ai"] = opts.vision;
  if (opts.games !== undefined) routes["/v4/games"] = Array.isArray(opts.games) ? { json: opts.games } : opts.games;
  routes["/v4/game_time_to_beats"] = {
    json: opts.length === undefined ? [] : [{ normally: opts.length, game_id: 0 }],
  };
  router = installFetchRouter(routes);
  return router;
}

/** A valid uploaded image `File`: accepted mime, non-empty, well under the 10 MB cap. */
function imageFile(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], "box.png", { type: "image/png" });
}

/** Build a `multipart/form-data` form with a `photo` file and optional `persist=true`. */
function photoForm(opts: { file?: File; persist?: boolean } = {}): FormData {
  const form = new FormData();
  form.set("photo", opts.file ?? imageFile());
  if (opts.persist) form.set("persist", "true");
  return form;
}

/** Construct the `APIContext` the POST handler destructures (`request`, `cookies`, `locals`). */
function postContext(form: FormData | undefined, user: unknown = { id: "user-1" }) {
  const request = form
    ? new Request("https://test.local/api/identify", { method: "POST", body: form })
    : new Request("https://test.local/api/identify", { method: "POST" });
  return { request, cookies: {} as never, locals: { user } } as unknown as Parameters<typeof POST>[0];
}

/** Construct the `APIContext` the GET handler destructures (`url`, `locals`). */
function getContext(params: { title?: string; platform?: string }, user: unknown = { id: "user-1" }) {
  const url = new URL("https://test.local/api/identify");
  if (params.title !== undefined) url.searchParams.set("title", params.title);
  if (params.platform !== undefined) url.searchParams.set("platform", params.platform);
  return { url, locals: { user } } as unknown as Parameters<typeof GET>[0];
}

/** A base-game candidate that grounds confidently for "Alan Wake II" on PlayStation 5 (id 100). */
function alanWakeMatch(): Game[] {
  return [game({ id: 100, name: "Alan Wake II", platforms: platforms("PlayStation 5"), total_rating_count: 200 })];
}

// vitest 4's `spyOn` is overloaded, so `ReturnType<typeof vi.spyOn>` collapses to `any`; name the
// spied procedure instead so `.mockRestore()` stays typed.
let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  holder.supabaseClient = null;
  // The vision/IGDB error paths log the upstream body server-side; keep test output clean.
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  mockCreateClient.mockClear();
});

afterEach(() => {
  router?.restore();
  router = undefined;
  errorSpy.mockRestore();
});

describe("POST /api/identify — abstain asymmetry (the two faces stay distinct)", () => {
  it("routes a low-confidence vision read to `unsure` and never touches Supabase (manual-entry face, FR-006/US-01)", async () => {
    // Oracle: a vision abstain is the manual-add fallback — no grounding, no save. This face must
    // stay distinct from the IGDB-no_match save face below.
    mockProviders({ vision: visionEnvelope({ title: "Blurry Box", platform: "PlayStation 5", confidence: 0.3 }) });

    const res = await POST(postContext(photoForm({ persist: true })));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "unsure", confidence: 0.3 });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("folds an unparseable vision envelope to `unsure` without saving", async () => {
    // A refusal / malformed structured payload is an honest abstain (vision.ts folds it), not a save.
    mockProviders({ vision: visionEnvelope("not-the-json-we-asked-for") });

    const res = await POST(postContext(photoForm({ persist: true })));

    await expect(res.json()).resolves.toMatchObject({ status: "unsure" });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("SAVES a confident vision read that IGDB-misses with metadata_status='no_match' (by-design save face)", async () => {
    // Oracle: the persist path INVERTS the harness fold — a confident read whose grounding misses is
    // still auto-saved with null id + `no_match`, NOT abstained. Asserted on the captured payload's
    // shape, not on the mere fact an insert ran (a ground-miss writes a row too).
    const { client, payload, insert } = insertClient();
    holder.supabaseClient = client;
    const r = mockProviders({
      vision: visionEnvelope({ title: "Obscure Shelf Game", platform: "Evercade", confidence: 0.9 }),
      games: [], // IGDB finds nothing → lookupGameMetadata returns no_match
    });

    const res = await POST(postContext(photoForm({ persist: true })));

    // `identify.ts` swallows ANY grounding throw into `grounding = null`, which maps to the same
    // `no_match` payload — so pin that grounding actually RAN. Without this the assertions below
    // pass even when the IGDB route is missing entirely (an exploded pipeline reads identically).
    expect(r.requests.some((req) => req.url.includes("/v4/games"))).toBe(true);
    await expect(res.json()).resolves.toMatchObject({ status: "identified", igdbId: null, metadataStatus: "no_match" });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(payload()).toMatchObject({ metadata_status: "no_match", igdb_id: null });
  });

  it("SAVES a confident vision read that IGDB-matches with metadata_status='matched' and the base id", async () => {
    const { client, payload } = insertClient();
    holder.supabaseClient = client;
    mockProviders({
      vision: visionEnvelope({ title: "Alan Wake II", platform: "PlayStation 5", confidence: 0.9 }),
      games: alanWakeMatch(),
      length: 36000,
    });

    const res = await POST(postContext(photoForm({ persist: true })));

    await expect(res.json()).resolves.toMatchObject({ status: "identified", igdbId: 100, metadataStatus: "matched" });
    expect(payload()).toMatchObject({
      title: "Alan Wake II",
      platform: "PlayStation 5",
      igdb_id: 100,
      metadata_status: "matched",
    });
  });

  it("folds a confident vision read + IGDB no_match to `unsure` on the harness path (persist off)", async () => {
    // The inverted, non-persist behavior: with no `persist`, a no_match grounding has no id to score,
    // so it abstains — distinct from the persist save face above. No Supabase client is constructed.
    const r = mockProviders({
      vision: visionEnvelope({ title: "Alan Wake II", platform: "PlayStation 5", confidence: 0.72 }),
      games: [],
    });

    const res = await POST(postContext(photoForm()));

    // Same reason as the persist face above: pin that the fold followed a real grounding miss,
    // not a swallowed transport failure.
    expect(r.requests.some((req) => req.url.includes("/v4/games"))).toBe(true);
    await expect(res.json()).resolves.toMatchObject({ status: "unsure", confidence: 0.72 });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/identify — normalize-before-ground", () => {
  it("normalizes the raw vision read BEFORE grounding, and the normalized values reach both IGDB and the save", async () => {
    // Oracle: `vision.ts` normalizes at its single choke point (shouty title → Title Case, platform
    // alias → canonical label) and every consumer inherits it. Proof requires the REAL normalizers,
    // so the vision module is NOT mocked. The IGDB search must carry the normalized title (grounding
    // ran on the clean value), and the saved payload must carry the normalized title + platform.
    const { client, payload } = insertClient();
    holder.supabaseClient = client;
    const r = mockProviders({
      vision: visionEnvelope({ title: "ALAN WAKE II", platform: "ps5", confidence: 0.9 }),
      games: alanWakeMatch(),
      length: 36000,
    });

    await POST(postContext(photoForm({ persist: true })));

    // The IGDB games search carried the NORMALIZED title, not the shouty raw read.
    const gamesReq = r.requests.find((req) => req.url.includes("/v4/games"));
    expect(gamesReq?.bodyText).toContain('search "Alan Wake II"');
    expect(gamesReq?.bodyText).not.toContain("ALAN WAKE II");
    // The normalized PLATFORM is asserted on the saved payload rather than the outgoing body on
    // purpose: `resolvePlatformIds` maps "ps5" and "PlayStation 5" to the same IGDB id (167), so an
    // outgoing-body platform assertion would pass without the normalizer and prove nothing. The
    // saved value is where the normalization is actually observable.
    // The saved values are the normalized forms ("ps5" → "PlayStation 5").
    expect(payload()).toMatchObject({ title: "Alan Wake II", platform: "PlayStation 5" });
  });
});

describe("POST /api/identify — vision request payload", () => {
  it("sends the uploaded photo to OpenRouter as a base64 data URL", async () => {
    // Oracle: the vision call must carry the image as a `data:<mime>;base64,<data>` URL built from
    // the upload's bytes. `imageFile()` is the 4 bytes [1,2,3,4] as image/png; base64([1,2,3,4]) is
    // "AQIDBA==" (RFC 4648), so the outgoing body must embed exactly `data:image/png;base64,AQIDBA==`.
    // Pins the whole `toBase64DataUrl` encoder, which the mocked fetch edge otherwise leaves unchecked.
    const r = mockProviders({
      vision: visionEnvelope({ title: "Whatever", platform: "PlayStation 5", confidence: 0.3 }),
    });

    await POST(postContext(photoForm()));

    const visionReq = r.requests.find((req) => req.url.includes("openrouter.ai"));
    expect(visionReq?.bodyText).toContain("data:image/png;base64,AQIDBA==");
  });
});

describe("POST /api/identify — auth & upload boundaries", () => {
  it("401s when unauthenticated (before any form parsing)", async () => {
    const res = await POST(postContext(undefined, null));
    expect(res.status).toBe(401);
  });

  it("400s when the `photo` part is missing", async () => {
    const res = await POST(postContext(new FormData()));
    expect(res.status).toBe(400);
  });

  it("400s on an empty `photo` file", async () => {
    const res = await POST(postContext(photoForm({ file: new File([], "empty.png", { type: "image/png" }) })));
    expect(res.status).toBe(400);
  });

  it("400s on an oversized `photo` (> 10 MB)", async () => {
    const tooBig = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    const res = await POST(postContext(photoForm({ file: tooBig })));
    expect(res.status).toBe(400);
  });

  it("accepts a `photo` exactly at the 10 MB limit (boundary is inclusive)", async () => {
    // The ">10 MB" case above only proves strictly-larger is rejected. This pins BOTH the limit
    // constant (10·1024·1024) and the inclusive `<=`: a file of exactly 10 MB must pass the size
    // gate. A confident vision abstain lets us read "passed the gate" as a clean 200 without the
    // grounding path.
    const exactly = new File([new Uint8Array(10 * 1024 * 1024)], "limit.png", { type: "image/png" });
    mockProviders({ vision: visionEnvelope({ title: "Blurry", platform: "PlayStation 5", confidence: 0.3 }) });
    const res = await POST(postContext(photoForm({ file: exactly })));
    expect(res.status).toBe(200);
  });

  it("400s on a non-image mime type", async () => {
    const res = await POST(postContext(photoForm({ file: new File(["hello"], "note.txt", { type: "text/plain" }) })));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/identify — upstream failure mapping (no leak)", () => {
  it("maps a non-2xx OpenRouter response to a status-only 502, never leaking the upstream body", async () => {
    mockProviders({ vision: { status: 500, body: "internal quota-detail: leak-me-xyz" } });

    const res = await POST(postContext(photoForm()));

    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain("500");
    expect(body).not.toContain("leak-me-xyz");
    expect(body).not.toContain("quota-detail");
  });
});

describe("GET /api/identify — grounding shortcut", () => {
  it("401s when unauthenticated", async () => {
    const res = await GET(getContext({ title: "Alan Wake II", platform: "PlayStation 5" }, null));
    expect(res.status).toBe(401);
  });

  it("502s on an IGDB transport failure WITHOUT leaking the Twitch secret or the minted bearer token", async () => {
    // The credential flow really transits: a cache-miss mint hits the Twitch token endpoint, and the
    // wrapper attaches `Bearer <token>` to the games request. When the games call fails, the 502 must
    // surface a status-only IGDB error — never the secret or the bearer that flowed through the pipeline.
    //
    // TRIPWIRE, NOT PROOF OF REDACTION. `identify.ts:108` returns the caught `error.message`
    // verbatim, so the negative assertions below can only fail if the IGDB wrapper starts embedding
    // credentials in its error text. Known gap — see test-plan §6.7 and plan.md "What We're NOT Doing".
    const r = mockProviders({ games: { status: 500, body: "igdb upstream boom" } });

    const res = await GET(getContext({ title: "Alan Wake II", platform: "PlayStation 5" }));

    expect(res.status).toBe(502);
    // Evidence the credential really transited the pipeline: the token was minted and attached.
    const tokenReq = r.requests.find((req) => req.url.includes("id.twitch.tv/oauth2/token"));
    expect(tokenReq).toBeDefined();
    const gamesReq = r.requests.find((req) => req.url.includes("/v4/games"));
    expect(gamesReq?.headers.get("authorization")?.toLowerCase()).toContain("test-twitch-token");
    // ...yet none of it reaches the client-facing body.
    const body = await res.text();
    expect(body).not.toContain("test-twitch-token");
    expect(body).not.toContain("test-twitch-client-secret");
  });
});
