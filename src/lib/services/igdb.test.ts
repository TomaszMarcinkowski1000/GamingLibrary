import { describe, expect, it } from "vitest";
import { platformsOverlap, resolvePlatformIds } from "./igdb";

// Platform-resolution cases derived from the F-03 enumerated platform-string artifacts
// (immortals-fenyx-rising, crash-tag-team-racing, danganronpa, the-swapper): a box label
// may name a console with a no-space alias, a parenthetical gloss, or a multi-platform string.

describe("resolvePlatformIds", () => {
  it("resolves the no-space PSVita alias to the PlayStation Vita id", () => {
    expect(resolvePlatformIds("PSVita")).toEqual([46]);
  });

  it("resolves a parenthetical gloss by unioning its recognized parts", () => {
    // "PSP (PlayStation Portable)" → both parts resolve to id 38.
    expect(resolvePlatformIds("PSP (PlayStation Portable)")).toEqual([38]);
  });

  it("resolves a multi-platform string to every console it names", () => {
    expect(resolvePlatformIds("Xbox Series X • Xbox One")).toEqual([169, 49]);
  });

  it("returns [] for an unmapped platform (Evercade → unfiltered search)", () => {
    expect(resolvePlatformIds("Evercade")).toEqual([]);
  });

  it("resolves a plain single platform unchanged", () => {
    expect(resolvePlatformIds("PlayStation 5")).toEqual([167]);
  });

  it("prefers an exact whole-string map hit over splitting (Xbox Series X|S)", () => {
    expect(resolvePlatformIds("Xbox Series X|S")).toEqual([169]);
  });
});

describe("platformsOverlap", () => {
  it("treats PSVita and PlayStation Vita as the same console", () => {
    expect(platformsOverlap("PSVita", "PlayStation Vita")).toBe(true);
  });

  it("treats PSP (PlayStation Portable) and PlayStation Portable as the same console", () => {
    expect(platformsOverlap("PSP (PlayStation Portable)", "PlayStation Portable")).toBe(true);
  });

  it("treats a multi-platform string as overlapping any one of its consoles", () => {
    expect(platformsOverlap("Xbox Series X • Xbox One", "Xbox Series X")).toBe(true);
  });

  it("rejects two distinct mapped consoles", () => {
    expect(platformsOverlap("PlayStation 5", "Xbox One")).toBe(false);
  });

  it("falls back to string equality for an unmapped platform", () => {
    expect(platformsOverlap("Evercade", "Evercade")).toBe(true);
    expect(platformsOverlap("Evercade", "PlayStation 5")).toBe(false);
  });
});
