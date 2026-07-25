import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteClient, updateClient } from "@test/helpers/supabase-mock";

// Contract tests for `PUT/PATCH/DELETE /api/library/[id]` — the HTTP translation half of Risk #6.
//
// THIS SUITE PROVES TRANSLATION, NOT OWNERSHIP. Read the 404 tests as "an empty result set becomes
// a 404", never as "user B cannot touch user A's row". The route writes exactly one predicate —
// `.eq("id", id)` — and deliberately enforces no ownership at all: RLS is the sole gate, by a
// ratified decision (`src/lib/services/library.ts:31-33`,
// `context/archive/2026-06-11-edit-and-delete-entry/plan.md:23,52`). The Supabase client here is a
// stub, so **every assertion in this file would return exactly the same result with RLS disabled**.
// Cross-user isolation is proven one layer down, in `supabase/tests/database/library_entries_rls.test.sql`
// (`npm run test:db`).
//
// What this layer genuinely owns: which status code each service outcome becomes, which id the
// handler forwards, which columns a PATCH writes, and which of the two guards fires first. The
// *real* service runs (only `@/lib/supabase` is stubbed), so the `PGRST116` → `EntryNotFoundError`
// → 404 chain is exercised end to end rather than mocked at its midpoint.
//
// Assertions read the OUTGOING call (the captured `.eq()` args, the captured patch) and not only the
// status code — Phase 1's impl-review (F2) recorded that a best-effort `catch` lets a status-only
// assertion pass even with the stub removed.

/**
 * Mutation-testing triage (`npx stryker run --mutate "src/pages/api/library/?id?.ts"` — the `[` `]`
 * in the filename are glob metacharacters, so `?id?` is how you address this file from the CLI).
 * **63.91% → 69.92% total** (75.22% → 78.15% covered), 85 → 93 killed, 28 → 26 survived, 20 → 14
 * uncovered. Four assertions did it, each answering §6.6's question — *would this change hurt a user
 * or the business?* — with a yes:
 * - the two `if (error instanceof EntryNotFoundError)` → `if (true)` mutants on PATCH and DELETE:
 *   every database failure reported as "Entry not found", so a timed-out delete reads as
 *   "already gone" and the user never retries. Closed by the two 500 tests below.
 * - `Response.json({ entry }, …)` → `Response.json({}, …)` on PATCH: the published 200 contract,
 *   held by nothing until now.
 * - `?? "Invalid input"` → `&& "Invalid input"` on both verbs: every validation failure collapsed
 *   into one generic sentence, in a string the form renders verbatim.
 *
 * The remaining 26 + 14 were triaged and consciously accepted. Do not chase them:
 *
 * **Cosmetic — error copy, not behaviour.** `{ error: "…" }` → `{}` / `""` on the 401, 404 and 500
 * paths (`:21,46,48,67,92,94,111,124,126` and their uncovered twins at `:26,72,116`). The client
 * keys off the status and carries its own fallback copy (`GameDialog.tsx:225`,
 * `DeleteEntryDialog.tsx:52`, `PlayStatusControl.tsx:78`). Killing these means pinning literals —
 * §6.6's "never pin an implementation detail to raise the score". The one message the user must act
 * on is the 400, and that one *is* asserted (by field attribution and by distinctness, not by text).
 *
 * **Equivalent mutants** — no input distinguishes them from the original:
 * - `:43,89` `Response.json(body, {})`: `Response.json` already defaults to status 200, so dropping
 *   the init on the two success paths changes nothing. (The same mutant on the 500 paths *does*
 *   change the status, and is killed.)
 * - `:38,84` `issues[0]?.message` → `issues[0].message`: zod guarantees a non-empty `issues` array
 *   whenever `success === false`, so the optional chain can never short-circuit.
 *
 * **Unreachable in practice:**
 * - `:25,71,115` `if (!id)` → `if (false)`, and the uncovered `"Missing entry id"` blocks behind
 *   them. Astro's file router only dispatches `[id].ts` when the segment is present and non-empty —
 *   `/api/library/` resolves to `index.ts`. The guard is defensive; no request can reach it, so
 *   neither the branch nor its mutant is observable. A test would have to fake a context the router
 *   cannot produce.
 * - `:6` `prerender = false` → `true`: build-time adapter config, invisible to any vitest harness.
 *   `astro check` and the build own it.
 */

// Inject Supabase by mocking `createClient`: a hoisted holder lets each test swap in a fresh
// capturing stub — or `null`, which is what the route sees when `SUPABASE_*` is unset.
const holder = vi.hoisted((): { supabaseClient: unknown } => ({ supabaseClient: null }));
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => holder.supabaseClient) }));

import { DELETE, PATCH, PUT } from "./[id]";

/** The id the handler must forward verbatim — a real uuid, so nothing can pass by coincidence. */
const ENTRY_ID = "6c0e1c1a-1d3f-4a2b-9c7e-5f2a8b4d0e11";

/** A complete, valid `updateEntrySchema` payload (PUT sends the whole editable set). */
const VALID_UPDATE = {
  title: "The Legend of Zelda",
  platform: "Switch",
  play_status: "playing_now",
  play_time_hours: 12,
  date_bought: "2026-06-01",
  genre: ["Action"],
  developer: ["Nintendo"],
  series: ["Zelda"],
  length_hours: 50,
  release_year: 2017,
  release_date: "2017-03-03",
  igdb_id: 7346,
  metadata_status: "matched",
};

/**
 * Construct the `APIContext` the handlers destructure (`request`, `params`, `cookies`, `locals`).
 *
 * Roughly the `identify.test.ts:90-104` factory plus `params` — a JSON body instead of `FormData`,
 * and no `cloudflare:workers` mock, because this route reaches neither KV nor IGDB.
 */
function context(opts: { method: string; id?: string; body?: unknown; rawBody?: string; user?: unknown }) {
  const { method, id = ENTRY_ID, user = { id: "user-1" } } = opts;
  const init: RequestInit = { method };
  if (opts.rawBody !== undefined) {
    init.body = opts.rawBody;
  } else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { "Content-Type": "application/json" };
  }
  const request = new Request(`https://test.local/api/library/${id}`, init);
  return { request, params: { id }, cookies: {} as never, locals: { user } } as unknown as Parameters<typeof PUT>[0];
}

/** Read `{ error }` off a parsed JSON body, so a call site can compare messages without asserting a shape. */
function errorMessage(body: unknown): unknown {
  return (body as { error?: unknown }).error;
}

beforeEach(() => {
  holder.supabaseClient = null;
});

describe("PUT/PATCH/DELETE /api/library/[id] — not-found translation", () => {
  it("PUT answers 404 on an empty result set, targeting the unmodified params.id", async () => {
    // `updateLibraryEntry` translates PostgREST's `PGRST116` ("no rows returned" for a `.single()`)
    // into `EntryNotFoundError`, which the route must answer as 404 — not 500 via the catch-all.
    const { client, eq } = updateClient({ data: null, error: { code: "PGRST116" } });
    holder.supabaseClient = client;

    const res = await PUT(context({ method: "PUT", body: VALID_UPDATE }));

    expect(res.status).toBe(404);
    // The id the handler actually put on the wire — not merely "a 404 came back".
    expect(eq()).toEqual(["id", ENTRY_ID]);
  });

  it("PATCH answers 404 on an empty result set, targeting the unmodified params.id", async () => {
    const { client, eq } = updateClient({ data: null, error: { code: "PGRST116" } });
    holder.supabaseClient = client;

    const res = await PATCH(context({ method: "PATCH", body: { play_status: "completed" } }));

    expect(res.status).toBe(404);
    expect(eq()).toEqual(["id", ENTRY_ID]);
  });

  it("DELETE answers 404 when no row was deleted, rather than a misleading 204", async () => {
    // The sharpest face of the three: a no-row delete is silent in Supabase, so without the
    // empty-`select('id')` → `EntryNotFoundError` translation this would report success on a row
    // that was never touched.
    const { client, eq } = deleteClient({ data: [], error: null });
    holder.supabaseClient = client;

    const res = await DELETE(context({ method: "DELETE" }));

    expect(res.status).toBe(404);
    expect(eq()).toEqual(["id", ENTRY_ID]);
  });

  // The other half of the discrimination: a database failure that is NOT "no such row" must not be
  // dressed up as one. A 404 tells the user their entry is gone; if a timed-out DELETE answered 404
  // the row would still be there and they would never retry. PUT's face of this is the `22P02` test
  // below; these two close the same gap for the verbs that lacked it (both `instanceof` checks
  // survived Phase 6's mutation pass as `if (true)` — i.e. every failure reported as "not found").

  it("PATCH answers 500 — not a misleading 404 — when the database fails for some other reason", async () => {
    const { client } = updateClient({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });
    holder.supabaseClient = client;

    const res = await PATCH(context({ method: "PATCH", body: { play_status: "completed" } }));

    expect(res.status).toBe(500);
  });

  it("DELETE answers 500 — not a misleading 404 — when the database fails for some other reason", async () => {
    // Sharper here than anywhere else: a 404 on a delete reads as "already deleted", so the user
    // stops. `deleteLibraryEntry` only derives not-found from an *empty* result set, never from an
    // error, and the route must preserve that distinction.
    const { client } = deleteClient({
      data: [],
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });
    holder.supabaseClient = client;

    const res = await DELETE(context({ method: "DELETE" }));

    expect(res.status).toBe(500);
  });
});

describe("PUT/PATCH/DELETE /api/library/[id] — success contracts", () => {
  it("PUT answers 200 with the updated row under `entry`", async () => {
    const row = { id: ENTRY_ID, title: "The Legend of Zelda" };
    const { client } = updateClient({ data: row, error: null });
    holder.supabaseClient = client;

    const res = await PUT(context({ method: "PUT", body: VALID_UPDATE }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ entry: row });
  });

  it("PATCH forwards ONLY the provided key, leaving the omitted columns out of the patch", async () => {
    // The whole point of `patchEntrySchema` (S-04 inline status change): a status-only edit must not
    // degrade into a full-row write that clobbers fields the inline control never showed the user.
    // Proven on the captured patch — a 200 alone would pass for a full-row write too.
    const row = { id: ENTRY_ID, play_status: "completed" };
    const { client, patch } = updateClient({ data: row, error: null });
    holder.supabaseClient = client;

    const res = await PATCH(context({ method: "PATCH", body: { play_status: "completed" } }));

    expect(res.status).toBe(200);
    expect(patch()).toEqual({ play_status: "completed" });
    // The published response contract, same as PUT's. Today's only caller (`PlayStatusControl.tsx`)
    // reconciles from its own state and never reads the body, which is exactly why dropping `entry`
    // would go unnoticed until the next consumer relied on it.
    await expect(res.json()).resolves.toEqual({ entry: row });
  });

  it("PATCH forwards an explicit null play_time_hours as a written column ('clear my hours')", async () => {
    // The null-vs-omitted distinction, carried through the route: `null` is a value to write, not a
    // key to drop. The schema half is pinned in `validation/library.test.ts`; this is the wire half.
    const { client, patch } = updateClient({ data: { id: ENTRY_ID }, error: null });
    holder.supabaseClient = client;

    await PATCH(context({ method: "PATCH", body: { play_time_hours: null } }));

    expect(patch()).toEqual({ play_time_hours: null });
  });

  it("DELETE answers 204 with an empty body", async () => {
    // 204 is a protocol boundary: "no content" means no bytes, so the body is asserted, not just
    // the status. `Response.json()` here would be a silent protocol violation.
    const { client, eq } = deleteClient({ data: [{ id: ENTRY_ID }], error: null });
    holder.supabaseClient = client;

    const res = await DELETE(context({ method: "DELETE" }));

    expect(res.status).toBe(204);
    await expect(res.text()).resolves.toBe("");
    expect(eq()).toEqual(["id", ENTRY_ID]);
  });
});

describe("PUT/PATCH/DELETE /api/library/[id] — guards, both faces", () => {
  // All three handlers check `if (!supabase)` BEFORE `if (!locals.user)`, and the vitest env stub
  // leaves `SUPABASE_*` undefined on purpose. So a 401 assertion written without the
  // `@/lib/supabase` mock above would hit the 500 branch and prove nothing about auth — the trap
  // this pair of faces exists to keep visible. See `context/foundation/test-plan.md` §6.4.
  const HANDLERS = [
    { name: "PUT", handler: PUT, body: VALID_UPDATE as unknown },
    { name: "PATCH", handler: PATCH, body: { play_status: "completed" } as unknown },
    { name: "DELETE", handler: DELETE, body: undefined },
  ];

  it.each(HANDLERS)(
    "$name 401s when unauthenticated, before touching the database",
    async ({ handler, name, body }) => {
      const from = vi.fn();
      holder.supabaseClient = { from };

      const res = await handler(context({ method: name, body, user: null }));

      expect(res.status).toBe(401);
      // The guard short-circuits: no query is built at all, for any verb.
      expect(from).not.toHaveBeenCalled();
    },
  );

  it.each(HANDLERS)(
    "documentation-of-behaviour: $name 500s with a config message when Supabase is unconfigured, even unauthenticated",
    async ({ handler, name, body }) => {
      // The config guard runs first, so an anonymous caller against a misconfigured deploy learns
      // "Supabase is not configured" instead of "Not authenticated". `prd.md:188` describes the
      // route surface as auth-gated, so the two are in tension — recorded, not fixed (see plan.md
      // "What We're NOT Doing"). If this goes red because the guards were reordered, that is a
      // decision to re-take, not a regression to revert.
      holder.supabaseClient = null;

      const res = await handler(context({ method: name, body, user: null }));

      expect(res.status).toBe(500);
      await expect(res.json()).resolves.toEqual({ error: "Supabase is not configured" });
    },
  );
});

describe("PUT/PATCH /api/library/[id] — malformed input", () => {
  it("PUT 400s on a body that is not JSON, without reaching the service", async () => {
    const { client, patch } = updateClient({ data: null, error: null });
    holder.supabaseClient = client;

    const res = await PUT(context({ method: "PUT", rawBody: "not-json-at-all" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid JSON body" });
    // An unparseable body must not escape into the service as `undefined`.
    expect(patch()).toBeUndefined();
  });

  it("PATCH 400s on a body that is not JSON, without reaching the service", async () => {
    const { client, patch } = updateClient({ data: null, error: null });
    holder.supabaseClient = client;

    const res = await PATCH(context({ method: "PATCH", rawBody: "{" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid JSON body" });
    expect(patch()).toBeUndefined();
  });

  it("PUT 400s with a message when the payload fails `updateEntrySchema`", async () => {
    const { client, patch } = updateClient({ data: null, error: null });
    holder.supabaseClient = client;

    const res = await PUT(context({ method: "PUT", body: { ...VALID_UPDATE, title: "   " } }));

    expect(res.status).toBe(400);
    // Matched on field attribution (`/title/i`), never on the literal: the wording comes from
    // zod/the schema, so pinning it would mirror the library and break on an upgrade while proving
    // nothing about the contract. Attribution is the half the user needs — `GameDialog.tsx:225`
    // renders this string verbatim, so a route that answered a generic "Invalid input" for every
    // failure (the `??` → `&&` mutant) would leave the user hunting for the bad field.
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/title/i) as unknown });
    expect(patch()).toBeUndefined();
  });

  it("PATCH 400s on an empty object (the at-least-one-field rule) without writing", async () => {
    const { client, patch } = updateClient({ data: null, error: null });
    holder.supabaseClient = client;

    const res = await PATCH(context({ method: "PATCH", body: {} }));

    expect(res.status).toBe(400);
    // A no-op patch reaching the database would answer 200 over a row it never changed.
    expect(patch()).toBeUndefined();
  });

  it("PATCH tells two different validation failures apart in the message it returns", async () => {
    // `PlayStatusControl.tsx:78` shows this string to the user verbatim, so "why was I rejected?"
    // has to survive the trip. Asserted as pairwise distinctness + non-emptiness rather than by
    // literal (§6.5's copy technique): rewording either message is not a failure, collapsing both
    // into one generic string is. Guards the `?? "Invalid input"` fallback against being turned
    // into an unconditional one.
    const { client } = updateClient({ data: null, error: null });
    holder.supabaseClient = client;

    const emptyBody = await PATCH(context({ method: "PATCH", body: {} }));
    const badEnum = await PATCH(context({ method: "PATCH", body: { play_status: "abandoned" } }));

    const emptyMsg = errorMessage(await emptyBody.json());
    const enumMsg = errorMessage(await badEnum.json());
    expect(emptyMsg).toMatch(/.+/);
    expect(enumMsg).toMatch(/.+/);
    expect(emptyMsg).not.toBe(enumMsg);
  });

  it("documentation-of-behaviour: a Postgres 22P02 (non-uuid id) surfaces as 500, not 400", async () => {
    // Nothing validates that `params.id` is a uuid (`[id].ts:25,70,114` only check `if (!id)`), so a
    // malformed id travels all the way to Postgres, comes back as `invalid input syntax for type
    // uuid`, misses the `EntryNotFoundError` branch, and lands in the catch-all as a server error —
    // a client mistake reported as a server fault. Recorded as gap 3 in plan.md "What We're NOT
    // Doing"; no PRD requirement bounds it, so this pins behaviour rather than a requirement.
    const { client } = updateClient({
      data: null,
      error: { code: "22P02", message: "invalid input syntax for type uuid" },
    });
    holder.supabaseClient = client;

    const res = await PUT(context({ method: "PUT", id: "not-a-uuid", body: VALID_UPDATE }));

    expect(res.status).toBe(500);
  });
});
