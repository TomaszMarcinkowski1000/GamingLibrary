import { describe, expect, it } from "vitest";
import { updateEntrySchema } from "./library";

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
