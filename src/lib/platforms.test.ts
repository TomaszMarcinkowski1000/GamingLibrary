import { describe, expect, it } from "vitest";
import { resolvePlatformIds } from "./services/igdb";
import { KNOWN_PLATFORMS, normalizePlatformLabel, normalizeTitleCasing } from "./platforms";

describe("KNOWN_PLATFORMS", () => {
  it("every curated platform except Evercade resolves to a non-empty IGDB id list", () => {
    for (const platform of KNOWN_PLATFORMS) {
      if (platform === "Evercade") {
        // Intentionally absent from the IGDB map → unfiltered title search.
        expect(resolvePlatformIds(platform)).toEqual([]);
        continue;
      }
      expect(resolvePlatformIds(platform).length).toBeGreaterThan(0);
    }
  });
});

describe("normalizePlatformLabel", () => {
  it.each([
    // PC media-format variants the vision model reads off older boxes.
    ["PC DVD", "PC"],
    ["PC CD-ROM", "PC"],
    ["Windows", "PC"],
    // PlayStation shorthands and glosses.
    ["PS5", "PlayStation 5"],
    ["PSVita", "PlayStation Vita"],
    ["psp", "PlayStation Portable"],
    // Nintendo shorthands.
    ["3DS", "Nintendo 3DS"],
    ["Switch", "Nintendo Switch"],
    // Xbox Series: standalone S preserved; ambiguous combined forms collapse to the default X.
    ["Xbox Series S", "Xbox Series S"],
    ["Xbox Series X|S", "Xbox Series X"],
    ["xbox series", "Xbox Series X"],
  ])("maps alias %j to canonical label %j", (raw, expected) => {
    expect(normalizePlatformLabel(raw)).toBe(expected);
  });

  it("returns an already-canonical KNOWN_PLATFORMS label unchanged", () => {
    expect(normalizePlatformLabel("PlayStation 4")).toBe("PlayStation 4");
    expect(normalizePlatformLabel("Xbox 360")).toBe("Xbox 360");
  });

  it("passes an unknown platform through, trimmed not blanked", () => {
    expect(normalizePlatformLabel("Evercade")).toBe("Evercade");
    expect(normalizePlatformLabel("  Evercade  ")).toBe("Evercade");
  });
});

describe("normalizeTitleCasing", () => {
  it.each([
    // Fully-shouty re-case, with minor words lowercased and never the first token.
    ["MAFIA THE OLD COUNTRY", "Mafia the Old Country"],
    ["THE LAST OF US", "The Last of Us"],
    // Roman numeral preserved in a fully-shouty title.
    ["GRAND THEFT AUTO IV", "Grand Theft Auto IV"],
    // Mixed-case: longer shouty token re-cased.
    ["Call of DUTY", "Call of Duty"],
    // Mixed-case acronym guard keeps a genuine embedded acronym.
    ["Portal RTX", "Portal RTX"],
    // Intra-word stylization passes through untouched.
    ["inFAMOUS", "inFAMOUS"],
    ["LittleBigPlanet", "LittleBigPlanet"],
    // Documented tradeoff: a fully-shouty acronym title loses its acronym.
    ["FIFA 23", "Fifa 23"],
  ])("casts %j to %j", (raw, expected) => {
    expect(normalizeTitleCasing(raw)).toBe(expected);
  });
});
