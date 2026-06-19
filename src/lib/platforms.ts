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

/** Normalize a free-text platform for alias lookup: lowercase, trim, collapse whitespace.
 * Mirrors `normalizePlatform` in `services/igdb.ts` so the two maps key identically — kept
 * local to avoid an `igdb` import in this picklist module. */
function normalizePlatformKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Alias (normalized lookup key) → canonical *display* label. Covers exactly the alias set
 * `PLATFORM_IDS_BY_NAME` (`services/igdb.ts`) already recognizes, so what grounding accepts
 * and what we persist/display stay in lockstep. Canonical targets prefer `KNOWN_PLATFORMS`
 * wording.
 *
 * Distinct from the other two platform maps: `KNOWN_PLATFORMS` is the human picklist and
 * `PLATFORM_IDS_BY_NAME` is alias→IGDB-id. This is the missing third map: alias→canonical label.
 *
 * Xbox Series: a standalone `Series S` read is preserved; the ambiguous combined forms
 * (`x|s`, `x/s`, bare `series`) collapse to the `KNOWN_PLATFORMS` default `"Xbox Series X"`.
 */
export const PLATFORM_DISPLAY_BY_ALIAS: ReadonlyMap<string, string> = new Map<string, string>([
  ["pc", "PC"],
  ["windows", "PC"],
  ["microsoft windows", "PC"],
  ["pc dvd", "PC"],
  ["pc dvd-rom", "PC"],
  ["pc cd", "PC"],
  ["pc cd-rom", "PC"],
  ["ps5", "PlayStation 5"],
  ["playstation 5", "PlayStation 5"],
  ["ps4", "PlayStation 4"],
  ["playstation 4", "PlayStation 4"],
  ["ps3", "PlayStation 3"],
  ["playstation 3", "PlayStation 3"],
  ["ps2", "PlayStation 2"],
  ["playstation 2", "PlayStation 2"],
  ["ps vita", "PlayStation Vita"],
  ["psvita", "PlayStation Vita"],
  ["playstation vita", "PlayStation Vita"],
  ["psp", "PlayStation Portable"],
  ["playstation portable", "PlayStation Portable"],
  ["switch 2", "Nintendo Switch 2"],
  ["nintendo switch 2", "Nintendo Switch 2"],
  ["switch", "Nintendo Switch"],
  ["nintendo switch", "Nintendo Switch"],
  ["wii u", "Wii U"],
  ["wii", "Wii"],
  ["nintendo 3ds", "Nintendo 3DS"],
  ["3ds", "Nintendo 3DS"],
  ["nintendo ds", "Nintendo DS"],
  ["xbox series s", "Xbox Series S"],
  ["xbox series x", "Xbox Series X"],
  ["xbox series x|s", "Xbox Series X"],
  ["xbox series x/s", "Xbox Series X"],
  ["xbox series", "Xbox Series X"],
  ["xbox one", "Xbox One"],
  ["xbox 360", "Xbox 360"],
]);

/**
 * Resolve a free-text platform read to a canonical display label. Returns the mapped label on
 * a hit and the *trimmed* input unchanged on a miss (e.g. `Evercade`, or any unmapped string) —
 * never an empty string or a throw.
 */
export function normalizePlatformLabel(raw: string): string {
  return PLATFORM_DISPLAY_BY_ALIAS.get(normalizePlatformKey(raw)) ?? raw.trim();
}

// Lowercase words that stay lowercase in Title Case unless they lead the title.
const MINOR_WORDS = new Set<string>([
  "the",
  "of",
  "and",
  "a",
  "an",
  "to",
  "in",
  "on",
  "for",
  "or",
  "nor",
  "but",
  "at",
  "by",
  "from",
  "with",
  "as",
]);

// A token whose letters are all roman-numeral characters (applied to the token's letters only).
const ROMAN_NUMERAL = /^[ivxlcdm]+$/i;

/** Title-case a single token: first character upper, the rest lower. */
function titleCaseToken(token: string): string {
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/**
 * Convert a shouty model read to human Title Case while preserving intentional intra-word
 * stylization (`inFAMOUS`, `LittleBigPlanet`, `DmC`) and embedded acronyms (`Portal RTX`).
 *
 * Two-mode design (see the change plan's Critical Implementation Details):
 *  - **fully shouty** (no token contains a lowercase letter): every all-caps token is re-cased
 *    uniformly — minor-word and roman-numeral rules apply, but **no** acronym guard, so real
 *    short words survive (`MAFIA THE OLD COUNTRY` → `Mafia the Old Country`, not `… OLD …`).
 *  - **mixed** (at least one token has a lowercase letter): the acronym guard applies, keeping
 *    genuine embedded acronyms uppercase (`Portal RTX`) while still re-casing longer shouty
 *    tokens (`Call of DUTY` → `Call of Duty`).
 *
 * Per-token precedence: (1) minor word and not first → lowercase; (2) roman numeral → keep
 * uppercase; (3) [mixed only] alphabetic length ≤ 3 → keep uppercase (acronym); (4) title-case.
 * Minor-word check precedes the acronym guard so 3-letter minor words (`THE`/`AND`/`FOR`) are
 * not frozen as acronyms.
 */
export function normalizeTitleCasing(raw: string): string {
  const tokens = raw.trim().split(/\s+/);
  if (tokens.length === 1 && tokens[0] === "") return raw.trim();

  const isFullyShouty = !tokens.some((token) => /[a-z]/.test(token));

  return tokens
    .map((token, index) => {
      // Mixed-branch stylization guard: a token with any lowercase letter is intentional.
      if (/[a-z]/.test(token)) return token;

      const letters = token.replace(/[^a-z]/gi, "");

      if (index > 0 && MINOR_WORDS.has(token.toLowerCase())) return token.toLowerCase();
      if (letters.length > 0 && ROMAN_NUMERAL.test(letters)) return token.toUpperCase();
      if (!isFullyShouty && letters.length > 0 && letters.length <= 3) return token.toUpperCase();
      return titleCaseToken(token);
    })
    .join(" ");
}
