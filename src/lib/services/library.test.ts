import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteClient,
  filterListClient,
  insertClient,
  listClient,
  selectLimitClient,
  updateClient,
} from "@test/helpers/supabase-mock";
import type { IgdbLookupResult } from "@/types";

// Mock the enrichment module so the service's mapping logic is tested in isolation —
// the real `igdb.ts` reaches out to IGDB/Twitch and pulls in `astro:env/server`.
vi.mock("./igdb", () => ({ lookupGameMetadata: vi.fn() }));

import { lookupGameMetadata } from "./igdb";
import {
  EntryNotFoundError,
  createLibraryEntry,
  createLibraryEntryFromGrounding,
  deleteLibraryEntry,
  getLibraryFacets,
  listAllEntries,
  listLibraryEntries,
  updateLibraryEntry,
} from "./library";

const mockLookup = vi.mocked(lookupGameMetadata);
const KV = {} as unknown as KVNamespace;

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

describe("createLibraryEntryFromGrounding", () => {
  it("maps a matched grounding onto the metadata columns with metadata_status='matched'", async () => {
    const { client, payload } = insertClient();

    await createLibraryEntryFromGrounding(client, { title: "Some Game", platform: "PC", grounding: MATCHED });

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

  it("maps a no_match grounding to null metadata columns + metadata_status='no_match'", async () => {
    const { client, payload } = insertClient();

    await createLibraryEntryFromGrounding(client, {
      title: "Obscure",
      platform: "Evercade",
      grounding: { status: "no_match" },
    });

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

  it("treats a null grounding (transport failure) as no_match", async () => {
    const { client, payload } = insertClient();

    await createLibraryEntryFromGrounding(client, { title: "Flaky", platform: "PC", grounding: null });

    expect(payload()).toMatchObject({
      igdb_id: null,
      metadata_status: "no_match",
      date_bought: today,
    });
  });

  it("does not perform an IGDB lookup (grounding is pre-resolved)", async () => {
    const { client } = insertClient();

    await createLibraryEntryFromGrounding(client, { title: "Some Game", platform: "PC", grounding: MATCHED });

    expect(mockLookup).not.toHaveBeenCalled();
  });
});

describe("updateLibraryEntry", () => {
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

  it("applies combined filters (AND across dimensions, OR within) plus a non-default sort", async () => {
    const { client, calls, range } = filterListClient([{ id: "x" }], 1);

    const result = await listLibraryEntries(client, {
      page: 1,
      pageSize: 20,
      statuses: ["not_played"],
      platforms: ["PlayStation 5"],
      genres: ["RPG", "Action"],
      series: ["Saga"],
      sort: "year_desc",
    });

    // Scalar columns filter with .in(); a multi-value list is OR within the dimension.
    expect(calls.in).toContainEqual(["play_status", ["not_played"]]);
    expect(calls.in).toContainEqual(["platform", ["PlayStation 5"]]);
    // Array (text[]) columns filter with .overlaps() so a row matching either value passes.
    expect(calls.overlaps).toContainEqual(["genre", ["RPG", "Action"]]);
    expect(calls.overlaps).toContainEqual(["series", ["Saga"]]);
    // Non-default sort → release_year desc, then a created_at desc tiebreaker, then a
    // final id tiebreaker for fully deterministic ordering across page boundaries.
    expect(calls.order).toEqual([
      ["release_year", { ascending: false }],
      ["created_at", { ascending: false }],
      ["id", undefined],
    ]);
    expect(range()).toEqual([0, 19]);
    expect(result).toEqual({ entries: [{ id: "x" }], total: 1 });
  });

  it("skips dimensions with empty arrays and uses a single created_at order for the default sort", async () => {
    const { client, calls } = filterListClient([], 0);

    await listLibraryEntries(client, { page: 1, pageSize: 20, statuses: [], genres: [] });

    expect(calls.in).toEqual([]);
    expect(calls.overlaps).toEqual([]);
    // Default sort is created_at (its own tiebreaker is skipped), then the final id tiebreaker.
    expect(calls.order).toEqual([
      ["created_at", { ascending: false }],
      ["id", undefined],
    ]);
  });
});

/**
 * The columns `recommend()` actually reads, each traced to the line in `recommendation.ts` that
 * reads it. Derived from the **engine**, not copied from `RECOMMENDATION_COLUMNS` — mirroring the
 * constant would restate the source instead of the requirement, and would stay green if a column
 * the engine needs were dropped from both at once.
 *
 * - `length_hours` — `recommendation.ts:74`, read in `lengthDistance` (which hands it to `bucketOf`),
 *   the dominant score term.
 * - `play_status` — `:90`/`:92` (`isEligible`), `:104`/`:115` (`statusPenalty`).
 * - `date_bought` — `:128`, the `newly_bought` novelty axis.
 * - `created_at` — `:128` (the `date_bought` fallback) and `:200`, the first tie-break key.
 * - `release_date` — `:131`, the `new_releases` / `comfort` novelty axis.
 * - `id` — `:148` and `:193` (novelty-rank keying and lookup) and `:203`, the final tie-break key.
 *
 * Asserted as *containment*, never equality: the select legitimately carries more than the engine
 * reads (`/play-next` renders `title`, `platform`, `release_year`), so adding a column must not be a
 * false failure.
 */
const ENGINE_READS = ["length_hours", "play_status", "date_bought", "created_at", "release_date", "id"];

describe("listAllEntries", () => {
  it("asks for every column the recommender reads", async () => {
    const { client, columns } = selectLimitClient({ data: [], error: null });

    await listAllEntries(client);

    // Split into columns rather than substring-matching the raw string: `id` occurs inside
    // `igdb_id`, so a `.includes("id")` check would pass on a select that never asked for the key.
    const selected = (columns() ?? "").split(",").map((column) => column.trim());
    for (const column of ENGINE_READS) {
      expect(selected).toContain(column);
    }
  });

  it("throws when Supabase returns an error, instead of handing the engine null rows", async () => {
    const { client } = selectLimitClient({ data: null, error: { message: "boom" } });

    // Returning here rather than throwing would let `recommend()` run over `null` — the page would
    // render an empty library instead of `/play-next`'s error state.
    // The exact object, not `toBeDefined()`: this asserts the PostgREST error is *propagated*.
    // A truthiness check also passes when the chain itself blows up with an unrelated TypeError,
    // which would prove nothing about propagation while staying green.
    await expect(listAllEntries(client)).rejects.toEqual({ message: "boom" });
  });
});

describe("getLibraryFacets", () => {
  it("returns the RPC's facet object", async () => {
    const facets = {
      platforms: [{ value: "PlayStation 5", count: 12 }],
      genres: [{ value: "RPG", count: 3 }],
      series: [],
      statuses: [{ value: "not_played", count: 5 }],
    };
    const rpc = vi.fn().mockResolvedValue({ data: facets, error: null });
    const client = { rpc } as never;

    await expect(getLibraryFacets(client)).resolves.toEqual(facets);
    expect(rpc).toHaveBeenCalledWith("library_facets");
  });

  it("throws on RPC error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    const client = { rpc } as never;

    await expect(getLibraryFacets(client)).rejects.toEqual({ message: "boom" });
  });
});
