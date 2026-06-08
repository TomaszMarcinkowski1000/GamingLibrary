import { IGDBClient, type Game } from "@api-wrappers/igdb-wrapper";
import { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET } from "astro:env/server";
import { z } from "zod";
import type { IgdbLookupResult } from "@/types";
import { createTokenCachingFetch } from "./igdb-token-cache";

// Per-request IGDB client factory.
//
// The Twitch credentials resolve at module load via `astro:env/server`, but the KV
// binding used for token caching is only available per request. So the client cannot be
// a module-level singleton — the caller resolves the KV namespace (e.g. from the
// Cloudflare runtime env) and passes it in, and the token-caching `fetch` closes over it.

/**
 * Construct an `IGDBClient` wired with the request's KV namespace for Twitch token
 * caching. Reads the Twitch app credentials from `astro:env/server`.
 *
 * Not a singleton: build one per request so the wrapped `fetch` binds to that request's
 * KV namespace.
 */
export function createIgdbClient(kv: KVNamespace): IGDBClient {
  // The secrets are declared `optional` in the env schema (so build/scaffold proceed
  // without live creds), hence `string | undefined`. A client without them is unusable,
  // so fail loudly rather than constructing a client that 401s on first call.
  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
    throw new Error(
      "Missing TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET — set them in .dev.vars (local) or Worker secrets (prod).",
    );
  }

  return new IGDBClient({
    clientId: TWITCH_CLIENT_ID,
    clientSecret: TWITCH_CLIENT_SECRET,
    fetch: createTokenCachingFetch(kv),
  });
}

// --- Input validation ---

/**
 * Lookup input contract: both fields are required, non-empty after trimming. An empty
 * `title` or `platform` is a programming/usage error, so `.parse()` throws a `ZodError`
 * rather than degrading to `no_match` (which is reserved for "IGDB found nothing").
 */
const lookupInputSchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  platform: z.string().trim().min(1, "platform is required"),
});

// --- Platform resolution ---

// `library_entries.platform` is free text (F-01), but the IGDB `games` query filters on
// numeric platform ids. This static map covers the collector's console set. An
// unrecognized platform resolves to an empty id list, which the caller treats as an
// unfiltered (best-effort) search rather than a forced `no_match`.
//
// Ids are IGDB v4 platform ids (https://api-docs.igdb.com platforms endpoint).
const PLATFORM_IDS_BY_NAME = new Map<string, number[]>([
  ["pc", [6]],
  ["windows", [6]],
  ["microsoft windows", [6]],
  ["ps5", [167]],
  ["playstation 5", [167]],
  ["ps4", [48]],
  ["playstation 4", [48]],
  ["ps3", [9]],
  ["playstation 3", [9]],
  ["ps vita", [46]],
  ["playstation vita", [46]],
  ["switch", [130]],
  ["nintendo switch", [130]],
  ["wii u", [41]],
  ["wii", [5]],
  ["nintendo 3ds", [37]],
  ["3ds", [37]],
  ["xbox series x", [169]],
  ["xbox series s", [169]],
  ["xbox series x|s", [169]],
  ["xbox series x/s", [169]],
  ["xbox series", [169]],
  ["xbox one", [49]],
  ["xbox 360", [12]],
]);

/** Normalize free-text platform for map lookup: lowercase, trim, collapse whitespace. */
function normalizePlatform(platform: string): string {
  return platform.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Resolve a free-text platform to IGDB platform id(s). Returns `[]` for an unrecognized
 * platform — the caller falls back to an unfiltered title search in that case.
 */
function resolvePlatformIds(platform: string): number[] {
  return PLATFORM_IDS_BY_NAME.get(normalizePlatform(platform)) ?? [];
}

// --- Field-mapping helpers ---

const SECONDS_PER_HOUR = 3600;

/** IGDB stores dates as Unix epoch seconds; emit a `YYYY-MM-DD` string for the `date` column. */
function toIsoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

type GameReleaseDate = NonNullable<Game["release_dates"]>[number];

/**
 * Read a release-date's platform id. When the query selects `release_dates.platform`,
 * IGDB returns a bare numeric id, but the typed model declares the expanded `Platform`
 * object — so accept both shapes.
 */
function releaseDatePlatformId(releaseDate: GameReleaseDate): number | undefined {
  const platform = releaseDate.platform as unknown as number | { id?: number } | undefined;
  return typeof platform === "number" ? platform : platform?.id;
}

/** Collect the non-empty `.name` values from a list of named IGDB entities. */
function names(entities: { name?: string }[] | undefined): string[] {
  return (entities ?? []).map((e) => e.name).filter((name): name is string => Boolean(name));
}

// --- Lookup service ---

/**
 * Look up IGDB metadata for a `title` + `platform`.
 *
 * Runs the `games` search (filtered to the resolved platform when recognized), and on a
 * hit a follow-up `game_time_to_beats` query for length. Maps both into the discriminated
 * {@link IgdbLookupResult}. An empty result is a returned `{ status: "no_match" }`, not a
 * throw. Infrastructure failures still propagate: an empty `title`/`platform` throws a
 * `ZodError`, and IGDB/Twitch transport, HTTP, or auth errors throw — callers must handle them.
 */
export async function lookupGameMetadata(title: string, platform: string, kv: KVNamespace): Promise<IgdbLookupResult> {
  const input = lookupInputSchema.parse({ title, platform });
  const client = createIgdbClient(kv);
  const platformIds = resolvePlatformIds(input.platform);

  // Query A — games: title search, optionally filtered by platform. `.fields()` (rather
  // than `.select()`) keeps the result typed as `Game`, so nested relations map cleanly.
  let gamesQuery = client.games
    .search(input.title)
    .fields(
      "id",
      "first_release_date",
      "genres.name",
      "involved_companies.developer",
      "involved_companies.company.name",
      "collections.name",
      "release_dates.date",
      "release_dates.platform",
    );

  if (platformIds.length > 0) {
    // `platforms` is an array of platform ids on the games endpoint, so filter the field
    // directly (`platforms = (id,…)`). Filtering `platforms.id` is rejected by IGDB
    // ("Invalid field name: 'game.platforms.id'").
    gamesQuery = gamesQuery.where((g) => g.platforms.in(platformIds));
  }

  const game = await gamesQuery.limit(1).first();
  if (!game) {
    return { status: "no_match" };
  }

  // Query B — length: separate endpoint, sparse coverage → nullable.
  const timeToBeat = await client.gameTimeToBeats
    .query()
    .fields("normally", "game_id")
    .whereRaw(`game_id = ${game.id}`)
    .first();
  const lengthHours = timeToBeat?.normally ? timeToBeat.normally / SECONDS_PER_HOUR : null;

  const genre = names(game.genres);
  const developer = names(
    (game.involved_companies ?? [])
      .filter((ic) => ic.developer === true)
      .map((ic) => ic.company)
      .filter((company): company is NonNullable<typeof company> => company != null),
  );
  const series = names(game.collections);

  const releaseYear =
    game.first_release_date != null ? new Date(game.first_release_date * 1000).getUTCFullYear() : null;

  // Prefer the matched platform's precise release date; fall back to the global first
  // release date (also the only source when the platform was unrecognized).
  const platformIdSet = new Set(platformIds);
  const matchedReleaseDate = (game.release_dates ?? []).find((rd) => {
    const pid = releaseDatePlatformId(rd);
    return pid != null && platformIdSet.has(pid);
  });
  const releaseDateSeconds = matchedReleaseDate?.date ?? game.first_release_date;
  const releaseDate = releaseDateSeconds != null ? toIsoDate(releaseDateSeconds) : null;

  return {
    status: "matched",
    igdbId: game.id,
    genre,
    developer,
    series,
    releaseYear,
    releaseDate,
    lengthHours,
  };
}
