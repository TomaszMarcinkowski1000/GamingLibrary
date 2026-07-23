import type { Game } from "@api-wrappers/igdb-wrapper";
import { afterEach, describe, expect, it } from "vitest";
import { type FetchRouter, installFetchRouter } from "../../../test/helpers/fetch-mock";
import { lookupGameMetadata } from "./igdb";

// Hermetic integration tests for `lookupGameMetadata`, the id-correctness core of Risk #1.
//
// The lookup is driven end-to-end through the *real* wrapper query serialization — only the
// network edge (`globalThis.fetch`) is mocked. `collapseToBaseGame`, `isConfidentMatch`, the
// field-map, and the boundary constants are all exercised for real; nothing internal is stubbed.
// That is deliberate: those are the seam under test. `igdb.test.ts` covers the same helpers as
// pure units — this file proves they are wired together correctly behind `lookupGameMetadata`.
//
// The oracle is authored base-game truth (hand-built `Game`-shaped fixtures encoding the
// documented edition-collapse / remake cases), NOT whatever IGDB currently returns and NOT any
// value copied out of `igdb.ts`. The S-09 shelf sample does not exist in-repo (gitignored), so
// the fixtures stand in as the independent oracle.

/** Build a `Game`-shaped fixture with only the fields the lookup reads (mirrors `igdb.test.ts`). */
function game(props: Partial<Game> & { id: number; name: string }): Game {
  return { slug: props.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), ...props };
}

const platforms = (...names: string[]) => names.map((name) => ({ name })) as Game["platforms"];
const genres = (...names: string[]) => names.map((name) => ({ name })) as Game["genres"];
const collections = (...names: string[]) => names.map((name) => ({ name })) as Game["collections"];
const developer = (name: string) => [{ developer: true, company: { name } }] as NonNullable<Game["involved_companies"]>;

/** Unix seconds for a UTC calendar date — keeps release-year fixtures human-readable. */
const unixDate = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 1000);

// A `{}`-shaped KV: `kv.get`/`kv.put` are undefined, so the token-caching fetch's guarded reads
// throw and fall through to a fresh mint on every call — which the router answers with the
// default Twitch token. See `test/stubs`/`igdb-token-cache.ts`.
const stubKv = {} as unknown as KVNamespace;

let router: FetchRouter | undefined;

afterEach(() => {
  router?.restore();
  router = undefined;
});

/**
 * Install the fetch edge for one lookup: the default Twitch token, the `/v4/games` search
 * returning `candidates`, and the `/v4/game_time_to_beats` follow-up returning `lengthSeconds`
 * (or an empty result when omitted). Returns the router so tests can assert the outgoing request.
 */
function mockIgdb(candidates: Game[], lengthSeconds?: number): FetchRouter {
  router = installFetchRouter({
    "/v4/games": { json: candidates },
    "/v4/game_time_to_beats": {
      json: lengthSeconds === undefined ? [] : [{ normally: lengthSeconds, game_id: candidates[0]?.id ?? 0 }],
    },
  });
  return router;
}

describe("lookupGameMetadata — edition-variant collapse", () => {
  it("collapses a Deluxe edition to the base-game id and surfaces the edition as collapsedFrom", async () => {
    // Oracle: a box read accurately as "Alan Wake II Deluxe Edition" must ground to the *base*
    // game's id (100), not the edition entry's (101). The base shares the boxed console, so the
    // `version_parent` relation collapse is trusted.
    const base = game({ id: 100, name: "Alan Wake II", platforms: platforms("PlayStation 5") });
    const deluxe = game({
      id: 101,
      name: "Alan Wake II Deluxe Edition",
      version_title: "Deluxe Edition",
      version_parent: base,
      platforms: platforms("PlayStation 5"),
    });
    const r = mockIgdb([deluxe]);

    const result = await lookupGameMetadata("Alan Wake II Deluxe Edition", "PlayStation 5", stubKv);

    expect(result).toMatchObject({ status: "matched", igdbId: 100, collapsedFrom: 101 });
    // The real wrapper serialization carried the title through to the IGDB games search.
    const gamesReq = r.requests.find((req) => req.url.includes("/v4/games"));
    expect(gamesReq?.bodyText).toContain('search "Alan Wake II Deluxe Edition"');
  });

  it("reads metadata off the collapsed base, not the edition (the igdb.ts:329 leak guard)", async () => {
    // The edition carries deliberately WRONG enrichment. If the field-map read off the edition
    // instead of the collapsed base, these assertions would surface the wrong values — this is the
    // precise "attaches the wrong edition's metadata" surface Risk #1 guards.
    const base = game({
      id: 200,
      name: "Alan Wake II",
      platforms: platforms("PlayStation 5"),
      total_rating_count: 200,
      first_release_date: unixDate(2023, 10, 27),
      genres: genres("Shooter"),
      // A publisher (developer:false) sits first so the `developer` mapping must actually filter on
      // the `developer === true` flag rather than take the first / every involved company.
      involved_companies: [
        { developer: false, company: { name: "Epic Games Publishing" } },
        ...developer("Remedy Entertainment"),
      ] as Game["involved_companies"],
      collections: collections("Alan Wake"),
    });
    const deluxe = game({
      id: 201,
      name: "Alan Wake II Deluxe Edition",
      version_parent: base,
      platforms: platforms("PlayStation 5"),
      first_release_date: unixDate(2099, 1, 1),
      genres: genres("WRONG-Genre"),
      involved_companies: developer("WRONG-Studio"),
      collections: collections("WRONG-Series"),
    });
    mockIgdb([deluxe], 51120); // 14.2h → ceil → 15

    const result = await lookupGameMetadata("Alan Wake II Deluxe Edition", "PlayStation 5", stubKv);

    expect(result).toMatchObject({
      status: "matched",
      igdbId: 200,
      collapsedFrom: 201,
      genre: ["Shooter"],
      developer: ["Remedy Entertainment"], // publisher excluded
      series: ["Alan Wake"],
      releaseYear: 2023,
      // Exact ISO date off the base's `first_release_date` (no per-platform `release_dates` → the
      // `?? first_release_date` fallback feeds `toIsoDate`). Pins the epoch-seconds→YYYY-MM-DD map.
      releaseDate: "2023-10-27",
      lengthHours: 15,
    });
  });

  it("prefers the base entry over an equally-named edition flagged by version_title", async () => {
    // Two candidates share the exact display name "Nova Prime"; only the top one carries a
    // `version_title`, so it is an edition entry with NO parent relation — this drives the
    // title-match fallback, not relation collapse. Both names are the same length, so the
    // shortest-name tie-break can't decide: only the edition flag (`isEditionEntry`) can. The
    // unflagged entry (501) is the base truth; the flagged one (500) is collapsed away.
    const edition = game({
      id: 500,
      name: "Nova Prime",
      version_title: "Deluxe Edition",
      platforms: platforms("PlayStation 5"),
      total_rating_count: 100,
    });
    const base = game({ id: 501, name: "Nova Prime", platforms: platforms("PlayStation 5"), total_rating_count: 100 });
    mockIgdb([edition, base]);

    const result = await lookupGameMetadata("Nova Prime", "PlayStation 5", stubKv);

    expect(result).toMatchObject({ status: "matched", igdbId: 501, collapsedFrom: 500 });
  });
});

describe("lookupGameMetadata — field-mapping edges", () => {
  it("maps a matched game with no release date to null releaseYear and releaseDate", async () => {
    // A confident match can still lack any release date (sparse IGDB coverage). The date maps must
    // degrade to null rather than construct a date from `undefined` (which would surface NaN year).
    const base = game({ id: 700, name: "Timeless", platforms: platforms("PlayStation 5"), total_rating_count: 100 });
    mockIgdb([base], 3600);

    const result = await lookupGameMetadata("Timeless", "PlayStation 5", stubKv);

    expect(result).toMatchObject({ status: "matched", igdbId: 700, releaseYear: null, releaseDate: null });
  });
});

describe("lookupGameMetadata — remake platform-agreement", () => {
  it("keeps the platform-correct remake instead of following parent_game to the older original", async () => {
    // Oracle: the Dead Space 2023 remake links to the 2008 original via `parent_game`, but the
    // original is on PS3/Xbox 360 — off the boxed console. Following that relation would ground to
    // a game the boxed platform excludes (a recall regression). The remake's own id (159119) is
    // the correct answer for an Xbox Series X box.
    const original = game({ id: 37, name: "Dead Space", platforms: platforms("PlayStation 3", "Xbox 360") });
    const remake = game({
      id: 159119,
      name: "Dead Space",
      parent_game: original,
      platforms: platforms("Xbox Series X|S", "PlayStation 5"),
      total_rating_count: 300,
    });
    mockIgdb([remake]);

    const result = await lookupGameMetadata("Dead Space", "Xbox Series X", stubKv);

    expect(result).toMatchObject({ status: "matched", igdbId: 159119, collapsedFrom: null });
  });
});

describe("lookupGameMetadata — abstain (no_match) faces", () => {
  it("degrades a thin single-character query to no_match rather than attaching a textual hit", async () => {
    // The "e" on Xbox Series X case (S-01): a one-char query returns a textual hit that is not the
    // boxed game. The composite scorer's thin-term gate degrades it to no_match.
    const everwild = game({ id: 1, name: "Everwild", platforms: platforms("Xbox Series X"), total_rating_count: 50 });
    mockIgdb([everwild]);

    await expect(lookupGameMetadata("e", "Xbox Series X", stubKv)).resolves.toEqual({ status: "no_match" });
  });

  it("degrades a name below the similarity floor to no_match even when the candidate is popular", async () => {
    const bayonetta = game({
      id: 5,
      name: "Bayonetta",
      platforms: platforms("PlayStation 5"),
      total_rating_count: 500,
    });
    mockIgdb([bayonetta]);

    await expect(lookupGameMetadata("Hades", "PlayStation 5", stubKv)).resolves.toEqual({ status: "no_match" });
  });

  it("degrades an explicit platform disagreement to no_match (platform veto)", async () => {
    const gow = game({ id: 6, name: "God of War", platforms: platforms("Xbox One"), total_rating_count: 500 });
    mockIgdb([gow]);

    await expect(lookupGameMetadata("God of War", "PlayStation 5", stubKv)).resolves.toEqual({ status: "no_match" });
  });

  it("returns no_match when IGDB yields an empty candidate list", async () => {
    mockIgdb([]);

    await expect(lookupGameMetadata("Nonexistent Game", "PlayStation 5", stubKv)).resolves.toEqual({
      status: "no_match",
    });
  });
});

// Confidence boundary constants — the assertions that kill the constant mutants. Each pair holds
// every other signal fixed and moves only across one threshold, so it pins that constant (and its
// comparison direction) rather than any incidental behavior. Fixture names are synthetic threshold
// probes, not real-game oracles — each carries its Sørensen–Dice arithmetic in a comment.
describe("lookupGameMetadata — confidence boundary constants", () => {
  const query = { title: "Orbit Nova", platform: "PlayStation 5" }; // normalized tokens: {orbit, nova}
  const lookup = () => lookupGameMetadata(query.title, query.platform, stubKv);

  describe("NAME_SIM_FLOOR (0.34)", () => {
    // Both fixtures are popular + platform-matching, so ONLY the name floor decides.
    it("matches a name just above the similarity floor", async () => {
      // {orbit,nova} ∩ {orbit,delta,prism} = 1 → dice = 2·1/(2+3) = 0.40 ≥ 0.34
      const c = game({
        id: 10,
        name: "Orbit Delta Prism",
        platforms: platforms("PlayStation 5"),
        total_rating_count: 500,
      });
      mockIgdb([c], 3600);
      await expect(lookup()).resolves.toMatchObject({ status: "matched", igdbId: 10 });
    });

    it("abstains on a name just below the similarity floor", async () => {
      // {orbit,nova} ∩ {orbit,delta,prism,vertex} = 1 → dice = 2·1/(2+4) = 0.333 < 0.34
      const c = game({
        id: 11,
        name: "Orbit Delta Prism Vertex",
        platforms: platforms("PlayStation 5"),
        total_rating_count: 500,
      });
      mockIgdb([c]);
      await expect(lookup()).resolves.toEqual({ status: "no_match" });
    });
  });

  describe("NAME_SIM_STRONG (0.8)", () => {
    // Both fixtures have zero popularity, so ONLY whether the name reaches "strong" decides:
    // a strong name skips the popularity corroboration; a borderline one requires it.
    it("matches a name at the strong threshold despite zero popularity", async () => {
      // {orbit,nova} ∩ {orbit,nova,delta} = 2 → dice = 2·2/(2+3) = 0.80 (not < 0.80 → strong)
      const c = game({ id: 20, name: "Orbit Nova Delta", platforms: platforms("PlayStation 5") });
      mockIgdb([c], 3600);
      await expect(lookup()).resolves.toMatchObject({ status: "matched", igdbId: 20 });
    });

    it("abstains on a borderline name just below the strong threshold with zero popularity", async () => {
      // {orbit,nova} ∩ {orbit,nova,delta,prism} = 2 → dice = 2·2/(2+4) = 0.667 < 0.80, pop 0 < 5
      const c = game({ id: 21, name: "Orbit Nova Delta Prism", platforms: platforms("PlayStation 5") });
      mockIgdb([c]);
      await expect(lookup()).resolves.toEqual({ status: "no_match" });
    });
  });

  describe("POP_FLOOR (5)", () => {
    // Both fixtures share a borderline name (dice 0.667 < 0.80), so ONLY the popularity floor
    // decides. "Orbit": {orbit,nova} ∩ {orbit} = 1 → dice = 2·1/(2+1) = 0.667.
    it("matches a borderline name whose popularity is exactly at the floor", async () => {
      const c = game({ id: 30, name: "Orbit", platforms: platforms("PlayStation 5"), total_rating_count: 5 });
      mockIgdb([c], 3600);
      await expect(lookup()).resolves.toMatchObject({ status: "matched", igdbId: 30 });
    });

    it("abstains on a borderline name whose popularity is just below the floor", async () => {
      const c = game({ id: 31, name: "Orbit", platforms: platforms("PlayStation 5"), total_rating_count: 4 });
      mockIgdb([c]);
      await expect(lookup()).resolves.toEqual({ status: "no_match" });
    });
  });

  describe("MIN_QUERY_INFO_CHARS (2)", () => {
    // The abstain suite's "e" case pins the floor from below (1 info-char → no_match). This pins the
    // comparison DIRECTION: a title with exactly 2 info-chars is not thin and must still ground, so
    // the gate is `< 2`, not `<= 2`. "Go" is a perfect name match (dice 1.0) on a popular PS5 entry,
    // so only the thin-term gate can turn it away.
    it("grounds a two-character title exactly at the info-chars floor", async () => {
      const c = game({ id: 40, name: "Go", platforms: platforms("PlayStation 5"), total_rating_count: 500 });
      mockIgdb([c], 3600);
      await expect(lookupGameMetadata("Go", "PlayStation 5", stubKv)).resolves.toMatchObject({
        status: "matched",
        igdbId: 40,
      });
    });

    it("abstains on a one-character title even against a perfectly-named popular candidate", async () => {
      // Isolates the thin-term gate from the name-similarity floor: "e" is a perfect name match
      // (dice 1.0) on a popular PS5 entry named "e", so ONLY the info-chars gate can reject it. The
      // abstain suite's "e" case leans on a name mismatch (Everwild); this one proves the gate fires
      // on its own — a would-be confident match is still degraded to no_match on a single-char query.
      const c = game({ id: 41, name: "e", platforms: platforms("PlayStation 5"), total_rating_count: 500 });
      mockIgdb([c]);
      await expect(lookupGameMetadata("e", "PlayStation 5", stubKv)).resolves.toEqual({ status: "no_match" });
    });
  });
});
