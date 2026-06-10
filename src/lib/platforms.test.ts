import { describe, expect, it } from "vitest";
import { resolvePlatformIds } from "./services/igdb";
import { KNOWN_PLATFORMS } from "./platforms";

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
