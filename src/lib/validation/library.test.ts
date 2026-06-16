import { describe, expect, it } from "vitest";
import { parseRecommendationParams, updateEntrySchema } from "./library";

const VALID = {
  title: "The Legend of Zelda",
  platform: "Switch",
  play_status: "playing_now",
  play_time_hours: 12,
  date_bought: "2026-06-01",
  genre: ["Action", "Adventure"],
  developer: ["Nintendo"],
  series: ["Zelda"],
  length_hours: 50,
  release_year: 2017,
  release_date: "2017-03-03",
  igdb_id: 7346,
  metadata_status: "matched",
};

describe("updateEntrySchema", () => {
  it("accepts a full valid payload", () => {
    const parsed = updateEntrySchema.safeParse(VALID);
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty title", () => {
    const parsed = updateEntrySchema.safeParse({ ...VALID, title: "   " });
    expect(parsed.success).toBe(false);
  });

  it("rejects an out-of-enum play_status", () => {
    const parsed = updateEntrySchema.safeParse({ ...VALID, play_status: "abandoned" });
    expect(parsed.success).toBe(false);
  });

  it("rejects a negative play_time_hours", () => {
    const parsed = updateEntrySchema.safeParse({ ...VALID, play_time_hours: -1 });
    expect(parsed.success).toBe(false);
  });

  it("trims array items and drops empties", () => {
    const parsed = updateEntrySchema.safeParse({ ...VALID, genre: ["  RPG  ", "", "  "] });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.genre).toEqual(["RPG"]);
    }
  });

  it("normalizes an empty date string to null", () => {
    const parsed = updateEntrySchema.safeParse({ ...VALID, date_bought: "" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.date_bought).toBeNull();
    }
  });
});

describe("parseRecommendationParams", () => {
  const parse = (qs: string) => parseRecommendationParams(new URLSearchParams(qs));

  it("defaults to all four buckets + newly_bought when empty", () => {
    expect(parse("")).toEqual({
      lengthBuckets: ["short", "medium", "long", "very_long"],
      mode: "newly_bought",
    });
  });

  it("reads repeated ?length= values, deduped and in canonical order", () => {
    expect(parse("length=long&length=short&length=short").lengthBuckets).toEqual(["short", "long"]);
  });

  it("reads comma-joined length values", () => {
    expect(parse("length=medium,very_long").lengthBuckets).toEqual(["medium", "very_long"]);
  });

  it("drops unknown length values", () => {
    expect(parse("length=short&length=bogus").lengthBuckets).toEqual(["short"]);
  });

  it("falls back to all four buckets when every length value is invalid", () => {
    expect(parse("length=nope&length=zzz").lengthBuckets).toEqual(["short", "medium", "long", "very_long"]);
  });

  it("accepts a valid mode", () => {
    expect(parse("mode=comfort").mode).toBe("comfort");
    expect(parse("mode=new_releases").mode).toBe("new_releases");
  });

  it("falls back to newly_bought for an invalid or missing mode", () => {
    expect(parse("mode=teleport").mode).toBe("newly_bought");
    expect(parse("length=short").mode).toBe("newly_bought");
  });
});
