import type { Game } from "@api-wrappers/igdb-wrapper";
import { describe, expect, it } from "vitest";
import { collapseToBaseGame, normalizeBaseTitle, platformsOverlap, resolvePlatformIds } from "./igdb";

/** Build a `Game`-shaped fixture with only the fields the collapse logic reads. */
function game(props: Partial<Game> & { id: number; name: string }): Game {
  return { slug: props.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), ...props };
}

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

// Edition-variant collapse cases derived from the F-03 enumerated edition-variant bucket
// (alan-wake-2, horizon-forbidden-west ×2, bloodborne, spider-man, …): a box read accurately
// as a Deluxe/GOTY/Complete edition must ground to the *base-game* id the truth set uses.

describe("normalizeBaseTitle", () => {
  it("strips trailing edition markers", () => {
    expect(normalizeBaseTitle("Alan Wake II Deluxe Edition")).toBe("alan wake ii");
    expect(normalizeBaseTitle("Horizon Forbidden West Complete Edition")).toBe("horizon forbidden west");
  });

  it("strips the multi-word Game of the Year phrase", () => {
    expect(normalizeBaseTitle("Bloodborne: Game of the Year Edition")).toBe("bloodborne");
    expect(normalizeBaseTitle("Bloodborne GOTY")).toBe("bloodborne");
  });

  it("strips a known possessive publisher prefix", () => {
    expect(normalizeBaseTitle("Marvel's Spider-Man")).toBe("spider man");
    expect(normalizeBaseTitle("Tom Clancy's Ghost Recon")).toBe("ghost recon");
  });

  it("does NOT strip a possessive that is part of the title (Assassin's Creed)", () => {
    expect(normalizeBaseTitle("Assassin's Creed")).toBe("assassins creed");
  });

  it("preserves a numeric suffix so distinct sequels stay distinct (over-collapse guard)", () => {
    expect(normalizeBaseTitle("Portal 2")).toBe("portal 2");
    expect(normalizeBaseTitle("Portal")).toBe("portal");
  });
});

describe("collapseToBaseGame", () => {
  it("collapses via the version_parent relation (edition → base)", () => {
    const base = game({ id: 100, name: "Alan Wake II" });
    const deluxe = game({
      id: 101,
      name: "Alan Wake II Deluxe Edition",
      version_title: "Deluxe Edition",
      version_parent: base,
    });
    const result = collapseToBaseGame([deluxe], { title: "Alan Wake II Deluxe Edition" });
    expect(result.base.id).toBe(100);
    expect(result.collapsedFrom).toBe(101);
  });

  it("collapses via the parent_game relation", () => {
    const base = game({ id: 200, name: "Horizon Forbidden West" });
    const complete = game({ id: 201, name: "Horizon Forbidden West Complete Edition", parent_game: base });
    const result = collapseToBaseGame([complete], { title: "Horizon Forbidden West Complete Edition" });
    expect(result.base.id).toBe(200);
    expect(result.collapsedFrom).toBe(201);
  });

  it("falls back to a base-title match when relations are absent", () => {
    const goty = game({ id: 300, name: "Bloodborne: Game of the Year Edition", version_title: "GOTY" });
    const base = game({ id: 301, name: "Bloodborne" });
    const result = collapseToBaseGame([goty, base], { title: "Bloodborne GOTY" });
    expect(result.base.id).toBe(301);
    expect(result.collapsedFrom).toBe(300);
  });

  it("resolves a possessive-prefixed base via the title-match fallback", () => {
    const goty = game({ id: 600, name: "Marvel's Spider-Man: Game of the Year Edition", version_title: "GOTY" });
    const base = game({ id: 601, name: "Marvel's Spider-Man" });
    const result = collapseToBaseGame([goty, base], { title: "Marvel's Spider-Man" });
    expect(result.base.id).toBe(601);
    expect(result.collapsedFrom).toBe(600);
  });

  it("does NOT merge genuinely distinct titles sharing a prefix (over-collapse guard)", () => {
    const portal2 = game({ id: 400, name: "Portal 2" });
    const portal = game({ id: 401, name: "Portal" });
    const result = collapseToBaseGame([portal2, portal], { title: "Portal 2" });
    expect(result.base.id).toBe(400);
    expect(result.collapsedFrom).toBeNull();
  });

  it("returns the top candidate unchanged when nothing collapses (recall floor)", () => {
    const base = game({ id: 500, name: "Hades" });
    const result = collapseToBaseGame([base], { title: "Hades" });
    expect(result.base.id).toBe(500);
    expect(result.collapsedFrom).toBeNull();
  });
});
