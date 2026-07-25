import { describe, expect, it } from "vitest";
import { lookupRequestSchema, parseRecommendationParams, patchEntrySchema, updateEntrySchema } from "./library";

/**
 * Mutation-testing triage (`npx stryker run --mutate "src/lib/validation/library.ts"`).
 * **80.28% → 91.55% total** (fully covered, no uncovered mutants), 57 → 65 killed, 14 → 6 survived.
 * Three assertions did it, each answering §6.6's question — *would this change hurt a user or the
 * business?* — with a yes:
 * - the two `isoDate` regex-anchor mutants (`^` and `$` dropped): unanchored, any string merely
 *   *containing* ten date-shaped characters validates and reaches a Postgres `date` column, where
 *   it fails as a 500 the user cannot act on. Exactly the layer-disagreement Risk #6 names.
 * - `min(1, "title is required")` → `min(1, "")` on `updateEntrySchema` and `lookupRequestSchema`:
 *   zod's own default names no field, and the route hands the message straight to the form.
 * - `patchEntrySchema`'s `message: "…"` → `""`: zod emits the empty string verbatim, and
 *   `PlayStatusControl.tsx:78` uses `??`, so `""` is not nullish and its fallback copy never fires —
 *   the user gets a blank error. (Note the asymmetry with the survivor below.)
 *
 * The remaining 6 were triaged and consciously accepted:
 *
 * **Equivalent mutants:**
 * - `:114` `rawMode ?? ""` → `?? "Stryker was here!"`: both fallbacks are non-members of
 *   `NOVELTY_MODES`, so `.includes()` is false either way and the mode falls back identically.
 * - `:51,75` the `_assignable` / `_patchAssignable` arrow bodies. These exist purely to make the
 *   schema-to-`LibraryEntryUpdate` assignability a compile error if it ever breaks; both are
 *   `void`ed and never called. Zero runtime behaviour, so no test can see the change — `astro check`
 *   is what owns them.
 *
 * **Invisible at the boundary that consumes it:**
 * - `:28` `.regex(…, "expected YYYY-MM-DD")` → `""`. `isoDate` is a union
 *   (`.regex().nullable().or(z.literal(""))`), so a failure surfaces as the *union's* issue and the
 *   regex's custom message never reaches `issues[0].message` — which is the only thing the routes
 *   read (`[id].ts:38,84`). The custom text is already dead copy in production; emptying it changes
 *   nothing a user sees. (Contrast the refine message above, which is not behind a union and is
 *   asserted.)
 *
 * **Unreachable in practice:**
 * - `:25` dropping `isoDate`'s `.trim()`. The only producers of these strings are
 *   `<input type="date">` and IGDB-derived ISO dates; neither emits padding. The empty-string →
 *   `null` branch reads the original value and is unaffected either way.
 */

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

  it("rejects a whitespace-only platform", () => {
    // prd.md:94 — "Title and platform are required". Trim happens before the length check,
    // so "   " is a blank platform, not a one-character one.
    const parsed = updateEntrySchema.safeParse({ ...VALID, platform: "   " });
    expect(parsed.success).toBe(false);
  });

  it.each([
    { name: "a trailing time component", value: "2026-06-01T00:00:00Z" },
    { name: "trailing digits", value: "2026-06-0199" },
    { name: "leading junk", value: "bought on 2026-06-01" },
  ])("rejects a date_bought with $name — the pattern is the whole string, not a substring", ({ value }) => {
    // The anchors are the contract. Unanchored, any string *containing* ten date-shaped
    // characters would validate and travel to a Postgres `date` column, where it fails as a
    // `22007` the route's catch-all reports as a 500 — the client mistake reported as a server
    // fault that Risk #6 is about. `date_bought`/`release_date` are the only free-text-reachable
    // date fields (the enrichment path writes IGDB-derived ISO dates).
    const parsed = updateEntrySchema.safeParse({ ...VALID, date_bought: value });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      // Non-empty, so the form has something to show. Not pinned to the wording.
      expect(parsed.error.issues[0]?.message).toMatch(/.+/);
    }
  });

  it("names the offending field when a required string is blank", () => {
    // `GameDialog.tsx:225` renders the route's 400 message verbatim, so "which field?" has to
    // survive the trip. Matched loosely (`/title/i`) rather than pinned to the literal — rewording
    // is not a failure, losing the attribution (or emptying the message) is. Same technique as
    // `src/pages/api/library/index.test.ts:128`, applied one layer down.
    // `lookupRequestSchema` is the same required-pair contract behind the edit dialog's
    // "Re-fetch metadata" button (`api/library/lookup.ts:31` returns its message the same way).
    const blanks = [
      { result: updateEntrySchema.safeParse({ ...VALID, title: "  " }), names: /title/i },
      { result: updateEntrySchema.safeParse({ ...VALID, platform: "  " }), names: /platform/i },
      { result: lookupRequestSchema.safeParse({ ...VALID, title: "  " }), names: /title/i },
      { result: lookupRequestSchema.safeParse({ ...VALID, platform: "  " }), names: /platform/i },
    ];

    for (const { result, names } of blanks) {
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(names);
      }
    }
  });

  // --- documentation-of-behaviour (not requirements) ------------------------------------
  // The two assertions below record what the server currently does at a point where no PRD
  // requirement bounds it. Neither catches a regression by design: if either goes red, that
  // is a decision to re-take, not a bug to fix. See plan.md "What We're NOT Doing" items 1
  // and 3 (context/changes/testing-route-contracts-isolation/plan.md).

  it("documentation-of-behaviour: accepts a fractional length_hours", () => {
    // The server half of a client/server divergence. `length_hours` is a `numeric` column
    // (migration 20260606150950:17) and the schema is deliberately non-integer, so 12.5 is
    // valid here — but the edit form's <Input type="number"> carries no `step`
    // (GameFormFields.tsx:197-205), so the browser's implicit step=1 blocks the whole form
    // submit and a row holding 12.5 becomes wholly un-editable. That defect violates
    // prd.md:140 FR-010 and is invisible at this layer: no schema test can observe it.
    // Recorded as gap 1 and flagged for a follow-up change; only a browser test can prove it.
    const parsed = updateEntrySchema.safeParse({ ...VALID, length_hours: 12.5 });
    expect(parsed.success).toBe(true);
  });

  it("documentation-of-behaviour: accepts a release_year the DB column cannot hold", () => {
    // `release_year` is a Postgres `integer` (migration 20260606150950:18), whose ceiling is
    // 2147483647. The schema only asks for an integer, so a larger value passes validation
    // and fails two layers later as a `22003` numeric-overflow that the route's catch-all
    // maps to 500 rather than 400. Recorded as gap 3; no PRD requirement bounds the year.
    const parsed = updateEntrySchema.safeParse({ ...VALID, release_year: 2_147_483_648 });
    expect(parsed.success).toBe(true);
  });
});

describe("patchEntrySchema", () => {
  it("rejects an empty object", () => {
    // The docstring's "at least one key must be present, so an empty body is rejected rather
    // than silently no-op'ing" (validation/library.ts:54-61).
    const parsed = patchEntrySchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      // Object-level rejection (empty `path`) — the at-least-one-field rule fired, not a
      // per-field rule. Asserted as shape rather than by message text: the wording lives in
      // validation/library.ts and has no oracle outside it, so pinning the literal would
      // mirror the source. Both keys are optional, so without that rule `{}` would parse.
      expect(parsed.error.issues).toHaveLength(1);
      expect(parsed.error.issues[0]?.path).toEqual([]);
      // Non-empty, for the same reason the field-attribution test above exists: `PlayStatusControl`
      // renders this string verbatim (`:78`), and `""` is not nullish, so its own fallback copy
      // never fires — the user would get a blank error and no way to act on it.
      expect(parsed.error.issues[0]?.message).toMatch(/.+/);
    }
  });

  it("accepts play_status alone", () => {
    const parsed = patchEntrySchema.safeParse({ play_status: "completed" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // The omitted key stays omitted — a partial patch must not clobber hours.
      expect(parsed.data).toEqual({ play_status: "completed" });
    }
  });

  it("accepts play_time_hours alone", () => {
    const parsed = patchEntrySchema.safeParse({ play_time_hours: 7 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ play_time_hours: 7 });
    }
  });

  it("accepts an explicit null play_time_hours as the only key", () => {
    // "clear my hours". An explicit `null` is a *present* key, so it satisfies the
    // at-least-one-field rule — the deliberate null-vs-omitted distinction the docstring
    // calls out. A `.refine()` rewritten as a truthiness check would reject this and
    // silently break the inline clear.
    const parsed = patchEntrySchema.safeParse({ play_time_hours: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ play_time_hours: null });
    }
  });

  it("rejects a negative play_time_hours", () => {
    // prd.md:70 — "accepts a non-negative integer".
    const parsed = patchEntrySchema.safeParse({ play_time_hours: -1 });
    expect(parsed.success).toBe(false);
  });

  it("accepts zero play_time_hours", () => {
    // The inclusive edge of the same rule, asserted from the other side: "non-negative"
    // includes zero, and zero is not "unset".
    const parsed = patchEntrySchema.safeParse({ play_time_hours: 0 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ play_time_hours: 0 });
    }
  });

  it("rejects a fractional play_time_hours", () => {
    // "integer" in prd.md:70 — unlike `length_hours`, hours played is whole-numbered.
    const parsed = patchEntrySchema.safeParse({ play_time_hours: 12.5 });
    expect(parsed.success).toBe(false);
  });

  it("rejects an out-of-enum play_status", () => {
    const parsed = patchEntrySchema.safeParse({ play_status: "abandoned" });
    expect(parsed.success).toBe(false);
  });

  it("strips an unknown key rather than carrying it into the patch", () => {
    // A body-supplied `user_id` must not reach the service. Ownership is enforced entirely
    // by RLS (services/library.ts:31-33) and the INSERT `WITH CHECK` — if this schema ever
    // gained a `user_id` key, that check would be the only remaining defense against a row
    // transfer. See supabase/tests/database/library_entries_rls.test.sql.
    const parsed = patchEntrySchema.safeParse({
      play_status: "played",
      user_id: "00000000-0000-0000-0000-000000000001",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ play_status: "played" });
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

  it("trims whitespace around comma-joined values, so a hand-typed URL keeps every filter", () => {
    // `?length=medium, very_long` — the shape a shared or hand-edited link takes. Without the trim
    // the padded value fails the known-bucket check and is silently *dropped*: the user asked for
    // two buckets and the page quietly filters on one, with no error to explain the difference.
    expect(parse("length=medium, very_long").lengthBuckets).toEqual(["medium", "very_long"]);
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
