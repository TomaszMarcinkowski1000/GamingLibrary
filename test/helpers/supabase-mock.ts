// Shared chainable Supabase-client stubs for the hermetic suites.
//
// Every builder here returns a hand-rolled object that mimics only the slice of the
// `postgrest-js` fluent API the code under test actually walks — `.from().update().eq().select().single()`
// and friends — and captures the arguments that flowed through it. Capturing matters more than the
// resolved value: a route/service assertion that reads only the final status code still passes when
// the stub is removed (Phase 1 impl-review, F2), whereas one that reads the captured `.eq()` args or
// the captured patch payload cannot.
//
// The builders were lifted verbatim from `src/lib/services/library.test.ts` (five inline copies) and
// `src/pages/api/identify.test.ts` (a sixth, a duplicate of the first) so the route suites consume a
// helper instead of adding a seventh copy. The 172 tests that were green before the extraction are
// the proof it was faithful. `selectLimitClient` is the one builder written here rather than lifted —
// `listAllEntries` had no test anywhere in the repo, so there was no inline original to move.
//
// The clients are cast to `never` so they satisfy the `SupabaseClient<Database>` parameter without
// the stub having to implement it — the same cast the inline originals used.
//
// KNOWN LIMITATION (carried over, deliberately not fixed): no builder captures the *second* argument
// of `select("*", { count, head })`, so `head: true` (the clamp re-fetch's count-only query) is
// indistinguishable from `head: false` (the page fetch). Nothing asserts on it today; a test that
// needs the distinction should add the capture rather than infer it.

import { vi } from "vitest";

/** Result shape a stubbed PostgREST terminal call resolves to. */
interface QueryResult<T> {
  data: T;
  error: unknown;
}

/**
 * Mock client for `.from().insert(payload).select().single()`.
 *
 * Captures the insert payload and echoes it back in the returned row (prefixed with a stub `id`),
 * because the create routes read the inserted row back into their response body.
 */
export function insertClient() {
  let captured: Record<string, unknown> | undefined;
  const single = vi.fn(() => Promise.resolve({ data: { id: "row-1", ...(captured ?? {}) }, error: null }));
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn((payload: Record<string, unknown>) => {
    captured = payload;
    return { select };
  });
  return {
    client: { from: vi.fn(() => ({ insert })) } as never,
    /** The payload handed to `.insert()`, or `undefined` if it was never called. */
    payload: () => captured,
    insert,
  };
}

/**
 * Mock client for `.from().update(patch).eq('id', id).select().single()`.
 *
 * Captures both the patch and the `.eq()` args, so a caller can prove *which* row was targeted and
 * *which* columns were written — the two things a status-code-only assertion cannot see.
 */
export function updateClient(result: QueryResult<unknown>) {
  let captured: Record<string, unknown> | undefined;
  let eqArgs: [string, string] | undefined;
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn((column: string, value: string) => {
    eqArgs = [column, value];
    return { select };
  });
  const update = vi.fn((patch: Record<string, unknown>) => {
    captured = patch;
    return { eq };
  });
  return {
    client: { from: vi.fn(() => ({ update })) } as never,
    /** The patch handed to `.update()`. */
    patch: () => captured,
    /** The `[column, value]` pair handed to `.eq()`. */
    eq: () => eqArgs,
  };
}

/** Mock client for `.from().delete().eq('id', id).select('id')`, capturing the `.eq()` args. */
export function deleteClient(result: QueryResult<unknown[]>) {
  let eqArgs: [string, string] | undefined;
  const select = vi.fn().mockResolvedValue(result);
  const eq = vi.fn((column: string, value: string) => {
    eqArgs = [column, value];
    return { select };
  });
  const del = vi.fn(() => ({ eq }));
  return {
    client: { from: vi.fn(() => ({ delete: del })) } as never,
    eq: () => eqArgs,
  };
}

/**
 * Mock client for the unfiltered page fetch, capturing the `.range(from, to)` args.
 *
 * `order` is chainable: the primary order, the optional `created_at` tiebreaker, and the final `id`
 * tiebreaker all return the same node before `.range()` resolves the page.
 */
export function listClient(rows: unknown[], count: number) {
  let rangeArgs: [number, number] | undefined;
  const range = vi.fn((from: number, to: number) => {
    rangeArgs = [from, to];
    return Promise.resolve({ data: rows, count, error: null });
  });
  const orderNode: Record<string, unknown> = { range };
  const order = vi.fn(() => orderNode);
  orderNode.order = order;
  const select = vi.fn(() => ({ order }));
  return {
    client: { from: vi.fn(() => ({ select })) } as never,
    range: () => rangeArgs,
  };
}

/**
 * Mock client for the unpaginated `.from().select(columns).limit(n)` fetch (`listAllEntries`).
 *
 * Captures the raw column string handed to `.select()`, so a caller can assert *which columns were
 * asked for* — the thing a "rows came back" assertion cannot see, and the thing that silently
 * breaks the recommender when a column is dropped. The result is supplied by the caller so both the
 * `{ data }` and `{ error }` branches are reachable.
 *
 * The row cap handed to `.limit()` is deliberately **not** captured: `RECOMMENDATION_MAX_ROWS` is a
 * defensive ceiling with no PRD anchor, so asserting its value would mirror the source rather than a
 * requirement. Add the capture if a test ever needs the distinction.
 */
export function selectLimitClient(result: QueryResult<unknown>) {
  let columns: string | undefined;
  const limit = vi.fn(() => Promise.resolve(result));
  const select = vi.fn((cols: string) => {
    columns = cols;
    return { limit };
  });
  return {
    client: { from: vi.fn(() => ({ select })) } as never,
    /** The raw column string handed to `.select()`, exactly as the service wrote it. */
    columns: () => columns,
  };
}

/**
 * Chainable mock recording every filter/order call.
 *
 * `select` returns one builder whose `ilike`/`in`/`overlaps`/`order` all return the same builder (so
 * the real chaining works); `range` resolves the page. Lets a test assert which PostgREST operator
 * each filter dimension used, not merely that a query ran.
 */
export function filterListClient(rows: unknown[], count: number) {
  const calls = {
    ilike: [] as [string, string][],
    in: [] as [string, unknown][],
    overlaps: [] as [string, unknown][],
    order: [] as [string, { ascending: boolean }][],
  };
  let rangeArgs: [number, number] | undefined;
  const builder: Record<string, unknown> = {
    ilike: vi.fn((col: string, pat: string) => {
      calls.ilike.push([col, pat]);
      return builder;
    }),
    in: vi.fn((col: string, vals: unknown) => {
      calls.in.push([col, vals]);
      return builder;
    }),
    overlaps: vi.fn((col: string, vals: unknown) => {
      calls.overlaps.push([col, vals]);
      return builder;
    }),
    order: vi.fn((col: string, opts: { ascending: boolean }) => {
      calls.order.push([col, opts]);
      return builder;
    }),
    range: vi.fn((from: number, to: number) => {
      rangeArgs = [from, to];
      return Promise.resolve({ data: rows, count, error: null });
    }),
  };
  const select = vi.fn(() => builder);
  return {
    client: { from: vi.fn(() => ({ select })) } as never,
    calls,
    range: () => rangeArgs,
  };
}
