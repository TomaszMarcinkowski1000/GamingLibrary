import { describe, expect, it } from "vitest";
import type { LibraryEntry, NoveltyMode, PlayStatus, RecommendationRequest } from "@/types";
import { LENGTH_BUCKETS, NOVELTY_MODES } from "@/types";
import {
  NULL_DISTANCE,
  bucketOf,
  isEligible,
  lengthDistance,
  noveltyRank,
  recommend,
  statusPenalty,
} from "./recommendation";

/**
 * Build a `LibraryEntry` stub. The recommender reads only a narrow column set, so the unfilled
 * fields are nulled and the whole thing is cast — mirroring `listAllEntries`'s partial select.
 */
function entry(overrides: Partial<LibraryEntry> & { id: string }): LibraryEntry {
  return {
    title: "Game",
    platform: "PC",
    play_status: "not_played",
    length_hours: null,
    release_date: null,
    release_year: null,
    date_bought: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as LibraryEntry;
}

const ALL_BUCKETS = [...LENGTH_BUCKETS];
const req = (mode: NoveltyMode, lengthBuckets = ALL_BUCKETS): RecommendationRequest => ({ lengthBuckets, mode });
const ids = (result: ReturnType<typeof recommend>): string[] =>
  result.status === "ranked" ? result.items.map((i) => i.entry.id) : [];

describe("bucketOf — boundary edges (inclusive-low / exclusive-high)", () => {
  it.each([
    [9.99, "short"],
    [10, "medium"],
    [29.99, "medium"],
    [30, "long"],
    [59.99, "long"],
    [60, "very_long"],
  ] as const)("%s hours → %s", (hours, bucket) => {
    expect(bucketOf(hours)).toBe(bucket);
  });

  it("null length → null bucket", () => {
    expect(bucketOf(null)).toBeNull();
  });
});

describe("lengthDistance", () => {
  it("is 0 for an in-bucket entry", () => {
    expect(lengthDistance(entry({ id: "a", length_hours: 5 }), ["short"])).toBe(0);
  });

  it("is NULL_DISTANCE for a null-length entry", () => {
    expect(lengthDistance(entry({ id: "a", length_hours: null }), ["short"])).toBe(NULL_DISTANCE);
  });

  it("grades distance: with short-only selected, medium < long < very_long", () => {
    const d = (hours: number) => lengthDistance(entry({ id: "x", length_hours: hours }), ["short"]);
    expect(d(20)).toBe(1); // medium
    expect(d(40)).toBe(2); // long
    expect(d(80)).toBe(3); // very_long
    expect(d(20)).toBeLessThan(d(40));
    expect(d(40)).toBeLessThan(d(80));
  });

  it("takes the minimum distance over a multi-select", () => {
    expect(lengthDistance(entry({ id: "x", length_hours: 80 }), ["short", "long"])).toBe(1);
  });
});

describe("isEligible — the one hard filter", () => {
  it("new modes exclude completed_100 but keep completed", () => {
    expect(isEligible(entry({ id: "a", play_status: "completed_100" }), "new_releases")).toBe(false);
    expect(isEligible(entry({ id: "a", play_status: "completed_100" }), "newly_bought")).toBe(false);
    expect(isEligible(entry({ id: "a", play_status: "completed" }), "new_releases")).toBe(true);
  });

  it("comfort excludes not_played but keeps everything else", () => {
    expect(isEligible(entry({ id: "a", play_status: "not_played" }), "comfort")).toBe(false);
    expect(isEligible(entry({ id: "a", play_status: "completed_100" }), "comfort")).toBe(true);
    expect(isEligible(entry({ id: "a", play_status: "playing_now" }), "comfort")).toBe(true);
  });
});

describe("statusPenalty", () => {
  it("new modes: completed is heavily penalized, all else 0", () => {
    expect(statusPenalty(entry({ id: "a", play_status: "completed" }), "new_releases")).toBe(1);
    for (const status of ["not_played", "playing_now", "played"] as PlayStatus[]) {
      expect(statusPenalty(entry({ id: "a", play_status: status }), "new_releases")).toBe(0);
    }
  });

  it("comfort: playing_now < played < completed < completed_100", () => {
    const p = (status: PlayStatus) => statusPenalty(entry({ id: "a", play_status: status }), "comfort");
    expect(p("playing_now")).toBeLessThan(p("played"));
    expect(p("played")).toBeLessThan(p("completed"));
    expect(p("completed")).toBeLessThan(p("completed_100"));
    expect(p("playing_now")).toBe(0);
    expect(p("completed_100")).toBe(1);
  });
});

describe("noveltyRank — rank-normalized [0,1], higher = better, null dates worst", () => {
  it("new_releases ranks newer release_date higher; null is worst", () => {
    const entries = [
      entry({ id: "old", release_date: "2020-01-01" }),
      entry({ id: "new", release_date: "2022-01-01" }),
      entry({ id: "mid", release_date: "2021-01-01" }),
      entry({ id: "none", release_date: null }),
    ];
    const rank = noveltyRank(entries, "new_releases");
    expect(rank.get("none")).toBe(0);
    expect(rank.get("new")).toBe(1);
    expect(rank.get("old") ?? -1).toBeLessThan(rank.get("mid") ?? -1);
    expect(rank.get("mid") ?? -1).toBeLessThan(rank.get("new") ?? -1);
  });

  it("comfort ranks older release_date higher; null is worst", () => {
    const entries = [
      entry({ id: "old", release_date: "2010-01-01" }),
      entry({ id: "new", release_date: "2022-01-01" }),
      entry({ id: "none", release_date: null }),
    ];
    const rank = noveltyRank(entries, "comfort");
    expect(rank.get("old")).toBe(1);
    expect(rank.get("none")).toBe(0);
    expect(rank.get("new") ?? -1).toBeLessThan(rank.get("old") ?? -1);
  });

  it("newly_bought ranks by date_bought (fallback created_at) descending", () => {
    const entries = [
      entry({ id: "early", date_bought: "2026-01-01" }),
      entry({ id: "late", date_bought: "2026-06-01" }),
      entry({ id: "fallback", date_bought: null, created_at: "2026-03-01T00:00:00Z" }),
    ];
    const rank = noveltyRank(entries, "newly_bought");
    expect(rank.get("late")).toBe(1);
    expect(rank.get("early")).toBe(0);
    expect(rank.get("early") ?? -1).toBeLessThan(rank.get("fallback") ?? -1);
    expect(rank.get("fallback") ?? -1).toBeLessThan(rank.get("late") ?? -1);
  });

  it("ties in the raw value share a normalized rank", () => {
    const entries = [entry({ id: "a", release_date: "2021-01-01" }), entry({ id: "b", release_date: "2021-01-01" })];
    const rank = noveltyRank(entries, "new_releases");
    expect(rank.get("a")).toBe(rank.get("b"));
  });
});

describe("recommend — length dominance", () => {
  it("an in-bucket completed game outranks an out-of-bucket not_played game in a new mode", () => {
    const inBucketCompleted = entry({ id: "completed", play_status: "completed", length_hours: 5 });
    const outOfBucketFresh = entry({ id: "fresh", play_status: "not_played", length_hours: 40 });
    const result = recommend([outOfBucketFresh, inBucketCompleted], req("new_releases", ["short"]));
    expect(ids(result)[0]).toBe("completed");
  });
});

describe("recommend — comfort status ordering (novelty held equal)", () => {
  it("ranks playing_now > played > completed > completed_100 when length & date are equal", () => {
    const mk = (id: string, status: PlayStatus) =>
      entry({ id, play_status: status, length_hours: 20, release_date: "2015-01-01" });
    const entries = [
      mk("c100", "completed_100"),
      mk("done", "completed"),
      mk("playing", "playing_now"),
      mk("played", "played"),
    ];
    expect(ids(recommend(entries, req("comfort")))).toEqual(["playing", "played", "done", "c100"]);
  });
});

describe("recommend — determinism & total-order tie-break", () => {
  const entries = [
    entry({ id: "z", play_status: "playing_now", length_hours: 20, release_date: "2020-01-01" }),
    entry({ id: "a", play_status: "played", length_hours: 5, release_date: "2021-01-01" }),
    entry({ id: "m", play_status: "not_played", length_hours: 80, release_date: "2019-01-01" }),
  ];

  it("produces identical order across repeated calls", () => {
    const first = ids(recommend(entries, req("new_releases")));
    const second = ids(recommend([...entries].reverse(), req("new_releases")));
    expect(first).toEqual(second);
  });

  it("breaks score ties by created_at ascending, then id ascending", () => {
    // Identical scoring inputs (in-bucket, same status, same date) ⇒ equal score ⇒ tie-break only.
    const tie = (id: string, created_at: string) =>
      entry({ id, created_at, play_status: "not_played", length_hours: 20, release_date: "2021-01-01" });
    const result = recommend(
      [tie("c", "2026-01-02T00:00:00Z"), tie("b", "2026-01-01T00:00:00Z"), tie("a", "2026-01-01T00:00:00Z")],
      req("new_releases"),
    );
    expect(ids(result)).toEqual(["a", "b", "c"]);
  });
});

describe("recommend — empty-state reasons", () => {
  it("empty library ⇒ empty_library", () => {
    const result = recommend([], req("newly_bought"));
    expect(result).toEqual({ status: "empty", reason: "empty_library", mode: "newly_bought" });
  });

  it("comfort with no previously-played games ⇒ mode_eligibility", () => {
    const entries = [entry({ id: "a", play_status: "not_played" }), entry({ id: "b", play_status: "not_played" })];
    expect(recommend(entries, req("comfort"))).toEqual({
      status: "empty",
      reason: "mode_eligibility",
      mode: "comfort",
    });
  });

  it("new mode where every entry is completed_100 ⇒ mode_eligibility", () => {
    const entries = [entry({ id: "a", play_status: "completed_100" })];
    expect(recommend(entries, req("new_releases"))).toEqual({
      status: "empty",
      reason: "mode_eligibility",
      mode: "new_releases",
    });
  });
});

describe("recommend — top-10 truncation", () => {
  it("returns at most the limit (default 10)", () => {
    const entries = Array.from({ length: 15 }, (_, i) =>
      entry({ id: `e${i}`, play_status: "not_played", length_hours: 20, release_date: "2021-01-01" }),
    );
    const result = recommend(entries, req("new_releases"));
    expect(result.status).toBe("ranked");
    if (result.status === "ranked") {
      expect(result.items).toHaveLength(10);
    }
  });

  it("honors a custom limit", () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry({ id: `e${i}`, play_status: "not_played", length_hours: 20 }),
    );
    const result = recommend(entries, req("new_releases"), 3);
    if (result.status === "ranked") {
      expect(result.items).toHaveLength(3);
    }
  });
});

describe("recommend — realistic spot-check (scratch)", () => {
  it("newly_bought ranks a recently-bought in-bucket game top and hides completed_100", () => {
    const library = [
      entry({
        id: "rdr2",
        play_status: "playing_now",
        length_hours: 50,
        date_bought: "2026-05-01",
        release_date: "2018-10-26",
      }),
      entry({
        id: "celeste",
        play_status: "completed_100",
        length_hours: 8,
        date_bought: "2026-06-10",
        release_date: "2018-01-25",
      }),
      entry({
        id: "hades",
        play_status: "played",
        length_hours: 25,
        date_bought: "2026-06-12",
        release_date: "2020-09-17",
      }),
      entry({
        id: "tunic",
        play_status: "not_played",
        length_hours: 12,
        date_bought: "2026-06-14",
        release_date: "2022-03-16",
      }),
      entry({
        id: "unknown",
        play_status: "not_played",
        length_hours: null,
        date_bought: "2026-06-15",
        release_date: null,
      }),
    ];
    const result = recommend(library, req("newly_bought"));
    const order = ids(result);
    // completed_100 excluded in a new mode; the null-length game sinks below all real-length ones.
    expect(order).not.toContain("celeste");
    expect(order[order.length - 1]).toBe("unknown");
    // Among real-length games (all in-bucket with every bucket selected), newest purchase wins.
    expect(order[0]).toBe("tunic");
  });
});

describe("NOVELTY_MODES coverage", () => {
  it("every mode yields a valid result on a mixed library", () => {
    const library = [
      entry({ id: "a", play_status: "playing_now", length_hours: 5, release_date: "2020-01-01" }),
      entry({ id: "b", play_status: "completed", length_hours: 40, release_date: "2015-01-01" }),
    ];
    for (const mode of NOVELTY_MODES) {
      expect(recommend(library, req(mode)).status).toBe("ranked");
    }
  });
});
