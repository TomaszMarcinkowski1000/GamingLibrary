/**
 * Curated platform list for the Add-game combobox.
 *
 * These are display labels matching the collector's real shelf. The combobox seeds from
 * this list (unioned with platforms already used in the user's library). Kept separate
 * from `PLATFORM_IDS_BY_NAME` in `services/igdb.ts` — that map is keyed by *normalized
 * lookup names* and drives IGDB platform filtering, whereas this is the human-facing
 * picklist.
 *
 * Every entry except `Evercade` normalizes (lowercase) to a `PLATFORM_IDS_BY_NAME` key,
 * so picking one yields platform-filtered enrichment. `Evercade` has no IGDB id and
 * intentionally degrades to an unfiltered title search.
 */
export const KNOWN_PLATFORMS: readonly string[] = [
  "Xbox Series X",
  "Xbox 360",
  "PlayStation 5",
  "PlayStation 4",
  "PlayStation 3",
  "PlayStation 2",
  "PlayStation Portable",
  "PlayStation Vita",
  "PC",
  "Nintendo Switch 2",
  "Nintendo Switch",
  "Nintendo 3DS",
  "Nintendo DS",
  "Evercade",
] as const;
