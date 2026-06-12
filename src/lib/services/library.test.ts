import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IgdbLookupResult } from "@/types";

// Mock the enrichment module so the service's mapping logic is tested in isolation —
// the real `igdb.ts` reaches out to IGDB/Twitch and pulls in `astro:env/server`.
vi.mock("./igdb", () => ({ lookupGameMetadata: vi.fn() }));

import { lookupGameMetadata } from "./igdb";
import {
  EntryNotFoundError,
  createLibraryEntry,
  deleteLibraryEntry,
  listLibraryEntries,
  updateLibraryEntry,
} from "./library";

const mockLookup = vi.mocked(lookupGameMetadata);
const KV = {} as unknown as KVNamespace;

/** Mock client capturing the insert payload; `.insert().select().single()` returns a stub row. */
function insertClient() {
  let captured: Record<string, unknown> | undefined;
  const single = vi.fn().mockResolvedValue({ data: { id: "row-1" }, error: null });
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn((payload: Record<string, unknown>) => {
    captured = payload;
    return { select };
  });
  return {
    client: { from: vi.fn(() => ({ insert })) } as never,
    payload: () => captured,
  };
}

const MATCHED: IgdbLookupResult = {
  status: "matched",
  igdbId: 42,
  genre: ["RPG"],
  developer: ["Acme"],
  series: ["Saga"],
  releaseYear: 2021,
  releaseDate: "2021-03-04",
  lengthHours: 12.5,
};

const today = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  mockLookup.mockReset();
});

describe("createLibraryEntry", () => {
  it("maps a matched lookup onto the metadata columns with metadata_status='matched'", async () => {
    mockLookup.mockResolvedValue(MATCHED);
    const { client, payload } = insertClient();

    await createLibraryEntry(client, KV, { title: "Some Game", platform: "PC" });

    expect(payload()).toMatchObject({
      title: "Some Game",
      platform: "PC",
      igdb_id: 42,
      genre: ["RPG"],
      developer: ["Acme"],
      series: ["Saga"],
      release_year: 2021,
      release_date: "2021-03-04",
      length_hours: 12.5,
      metadata_status: "matched",
      date_bought: today,
    });
  });

  it("maps a no_match lookup to null metadata columns + metadata_status='no_match'", async () => {
    mockLookup.mockResolvedValue({ status: "no_match" });
    const { client, payload } = insertClient();

    await createLibraryEntry(client, KV, { title: "Obscure", platform: "Evercade" });

    expect(payload()).toMatchObject({
      title: "Obscure",
      platform: "Evercade",
      igdb_id: null,
      genre: null,
      developer: null,
      series: null,
      release_year: null,
      release_date: null,
      length_hours: null,
      metadata_status: "no_match",
      date_bought: today,
    });
  });

  it("folds a thrown enrichment error into a no_match save without propagating", async () => {
    mockLookup.mockRejectedValue(new Error("IGDB transport failure"));
    const { client, payload } = insertClient();

    await expect(createLibraryEntry(client, KV, { title: "Flaky", platform: "PC" })).resolves.toBeDefined();

    expect(payload()).toMatchObject({
      igdb_id: null,
      metadata_status: "no_match",
      date_bought: today,
    });
  });
});

describe("updateLibraryEntry", () => {
  /** Mock client for `.update(patch).eq('id', id).select().single()`, capturing the patch. */
  function updateClient(result: { data: unknown; error: unknown }) {
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
      patch: () => captured,
      eq: () => eqArgs,
    };
  }

  it("writes the patch, scopes by id, and returns the updated row", async () => {
    const row = { id: "row-1", title: "New Title" };
    const { client, patch, eq } = updateClient({ data: row, error: null });

    const result = await updateLibraryEntry(client, "row-1", { title: "New Title" });

    expect(patch()).toEqual({ title: "New Title" });
    expect(eq()).toEqual(["id", "row-1"]);
    expect(result).toEqual(row);
  });

  it("throws EntryNotFoundError when the update matches no row (PGRST116)", async () => {
    const { client } = updateClient({ data: null, error: { code: "PGRST116" } });

    await expect(updateLibraryEntry(client, "missing", { title: "x" })).rejects.toBeInstanceOf(EntryNotFoundError);
  });
});

describe("deleteLibraryEntry", () => {
  /** Mock client for `.delete().eq('id', id).select('id')`. */
  function deleteClient(result: { data: unknown[]; error: unknown }) {
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

  it("deletes by id when a row is affected", async () => {
    const { client, eq } = deleteClient({ data: [{ id: "row-1" }], error: null });

    await expect(deleteLibraryEntry(client, "row-1")).resolves.toBeUndefined();
    expect(eq()).toEqual(["id", "row-1"]);
  });

  it("throws EntryNotFoundError when the delete affects no row", async () => {
    const { client } = deleteClient({ data: [], error: null });

    await expect(deleteLibraryEntry(client, "missing")).rejects.toBeInstanceOf(EntryNotFoundError);
  });
});

describe("listLibraryEntries", () => {
  /** Mock client capturing the `.range(from, to)` args; returns stub rows + count. */
  function listClient(rows: unknown[], count: number) {
    let rangeArgs: [number, number] | undefined;
    const range = vi.fn((from: number, to: number) => {
      rangeArgs = [from, to];
      return Promise.resolve({ data: rows, count, error: null });
    });
    const order = vi.fn(() => ({ range }));
    const select = vi.fn(() => ({ order }));
    return {
      client: { from: vi.fn(() => ({ select })) } as never,
      range: () => rangeArgs,
    };
  }

  it("computes from/to from page and pageSize and returns entries + total", async () => {
    const { client, range } = listClient([{ id: "a" }], 57);

    const result = await listLibraryEntries(client, { page: 3, pageSize: 20 });

    expect(range()).toEqual([40, 59]);
    expect(result).toEqual({ entries: [{ id: "a" }], total: 57 });
  });

  it("clamps page to >= 1", async () => {
    const { client, range } = listClient([], 0);

    await listLibraryEntries(client, { page: 0, pageSize: 20 });

    expect(range()).toEqual([0, 19]);
  });
});
