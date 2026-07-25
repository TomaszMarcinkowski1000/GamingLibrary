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

/**
 * Mutation-testing triage (`npx stryker run --mutate "src/lib/services/recommendation.ts"`).
 * **92.36% → 94.27% total** (94.16% → 96.10% covered), 145 → 148 killed, 9 → 6 survived, 3
 * uncovered. The gain came from two fixture changes, not new tests: giving the permutation suite
 * (`:322-425`) a tied *triple* whose `created_at` values exercise both tie-break branches, and
 * making the tie-break fixture at `:455` actually discriminate. The sibling copy module scores
 * 100.00% (14/14) — see `recommendationCopy.test.ts`. Every survivor below was put to §6.6's
 * question — *would this change hurt a user or the business?* — and consciously accepted. All six
 * are equivalent or unreachable; none is a live behaviour gap. Do not chase the remaining points;
 * re-triage only if the set shifts.
 *
 * **Equivalent mutants** — no input distinguishes them from the original:
 * - `:131` `release_date === null ? NaN : …`: `Date.parse(null)` is already `NaN`, as are
 *   `undefined` and `""`; the ternary is a type guard, not behaviour.
 * - `:201` / `:204` `<` → `<=`: each sits inside a `!==` guard, where the two operators agree.
 *   `created_at` and `id` are non-nullable strings, so no coercion case escapes the guard.
 *
 * **Unreachable, or harmless in practice** — the triggering input cannot arrive, or the difference
 * is unobservable:
 * - `:60` dropping `lengthHours >= minH`: the buckets are contiguous and iterated low→high, so for
 *   every *number* — negatives included, via the `short` fallthrough — the upper bound alone picks
 *   the same bucket. `NaN` is the one divergence: it fails every `<` and lands in the open-ended
 *   `very_long` rather than `short`. `z.number()` rejects `NaN` on every write path.
 * - `:65` the negative-length fallthrough: negatives are blocked independently by
 *   `z.number().min(0)` (`validation/library.ts:41`) on the edit path, and by `lengthHoursFromSeconds`
 *   returning `null` for `<= 0` (`igdb.ts:163-167`) on the create/enrichment path, which writes
 *   `length_hours` straight through `metadataFromGrounding` without zod. There is no DB CHECK
 *   behind either — `length_hours numeric` is unconstrained.
 * - `:75` the empty-bucket-selection guard: `parseRecommendationParams` falls back to all four
 *   buckets (`validation/library.ts:110-111`) and is the only production producer of `lengthBuckets`.
 * - `:129` `-Infinity` for an unparseable purchase date: `date_bought ?? created_at` reads a `date`
 *   and a non-null `timestamptz` column, so `Date.parse` cannot meet a malformed string.
 * - `:203` `if (a.id !== b.id)` → `if (true)`: `id` is the primary key and `listAllEntries` is a
 *   single-table select, so production never supplies duplicate ids. Even if it did, the original's
 *   `return 0` and the mutant's `1` take the same path — `Array.sort` only ever tests `cmp < 0`.
 * - `:224` the `getRecommendations` body: the Supabase I/O boundary, out of scope for a unit
 *   harness. This one leaves a genuine hole rather than a covered one — `listAllEntries` has no
 *   test anywhere in the repo, and there is no e2e layer yet (test-plan Phases 3-4).
 *
 * **Killed, but worth knowing why it is asserted at all:** dropping the `created_at` tie-break
 * branch (`:200`) is a real behaviour change, and it is now caught by the test at `:455` — which is
 * **documentation-of-behaviour, not spec**. The PRD mandates determinism (`prd.md:84`, restated at
 * `:182`) but never names an ordering key, and "oldest first" appears nowhere in it, so pinning
 * `created_at` as *the* key would be Oracle Hazard #4 if claimed as a rule. Determinism itself is
 * asserted spec-side, key-agnostically, by the permutation suite at `:322-425`.
 */

const ALL_BUCKETS = [...LENGTH_BUCKETS];
const req = (mode: NoveltyMode, lengthBuckets = ALL_BUCKETS): RecommendationRequest => ({ lengthBuckets, mode });
const ids = (result: ReturnType<typeof recommend>): string[] =>
  result.status === "ranked" ? result.items.map((i) => i.entry.id) : [];

/** The two modes the PRD's "de-prioritized except under comfort" rule applies to (`prd.md:83`). */
const NEW_MODES = NOVELTY_MODES.filter((mode) => mode !== "comfort");

/**
 * Position of an id in a ranked order, where *absent* means "ranked below everything". That
 * conflation is deliberate: the PRD asks for de-prioritization (`prd.md:83`), and both excluding a
 * game and ranking it last satisfy that — so a rank comparison stays true under either
 * implementation, where `not.toContain` only holds under exclusion.
 */
const rankOf = (order: string[], id: string): number => {
  const index = order.indexOf(id);
  return index === -1 ? Infinity : index;
};

describe("bucketOf — boundary edges (inclusive-low / exclusive-high)", () => {
  /**
   * Which oracle backs which edge — not all six cases are equal.
   *
   * - `9.99` / `10` are **spec-backed**: FR-016 (`prd.md:160`) defines short as "< 10h", so 10
   *   belongs to medium unambiguously.
   * - `29.99` / `30` are **documentation-of-behaviour**: FR-016 says "medium (10–30h), long
   *   (30h+)" — both buckets can claim 30, so the spec gives no oracle. `30 → long` records what
   *   `LENGTH_BUCKET_BOUNDS` (`types.ts:113-117`) does today, not a rule.
   * - `59.99` / `60` are **documentation-of-behaviour** too, and more so: FR-016 defines three
   *   buckets ending at "long (30h+)"; `very_long` is a code-only fourth bucket with no FR at all.
   *
   * Do not treat a failure on the 30h or 60h rows as a spec violation — treat it as a decision to
   * re-take. See test-plan §6.5.
   */
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

describe("recommend — the 10h bucket boundary reaches the ranked output", () => {
  /**
   * Oracle: FR-016 (`prd.md:160`) defines short as "< 10h", so a 10.0h game belongs to `medium`
   * unambiguously — the one length boundary the spec actually decides. `bucketOf(10)` is already
   * pinned at the helper level (`:66-75`), but nothing proved the boundary survives
   * `bucketOf` → `lengthDistance` → `scoreOf` → sort into the list the user reads.
   *
   * The 9.99h entry is given the tie-break-favoured position (older `created_at`, smaller `id`) on
   * purpose. If a `>=`/`>` flip at `recommendation.ts:60` or a bounds edit at `types.ts:113-117`
   * pushed exactly-10h into `short`, both entries would sit at distance 1 from `medium`, tie on
   * score, and the tie-break would hand the top slot to 9.99h — so this fails on the regression
   * rather than passing by luck.
   */
  it("ranks a 10.0h game above a 9.99h one when medium is the selected bucket", () => {
    const atBoundary = (id: string, lengthHours: number, createdAt: string) =>
      entry({
        id,
        length_hours: lengthHours,
        created_at: createdAt,
        release_date: "2021-01-01",
        date_bought: "2026-01-01",
      });
    // aaa-/zzz- ids and the older created_at both favour 9.99h under the tie-break.
    const justUnder = atBoundary("aaa-9-99h", 9.99, "2026-01-01T00:00:00Z");
    const exactlyTen = atBoundary("zzz-10h", 10, "2026-06-01T00:00:00Z");

    expect(ids(recommend([justUnder, exactlyTen], req("new_releases", ["medium"])))).toEqual(["zzz-10h", "aaa-9-99h"]);
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

describe("recommend — 100%-complete de-prioritization, asserted as direction", () => {
  /**
   * Oracle: "100%-completed games are de-prioritized except under the 'comfort' mode"
   * (`prd.md:83`, restated at `:180`). The spec says *de-prioritized*; the code *excludes*
   * (`isEligible`, `recommendation.ts:92`). Asserting absence — as the spot-check's
   * `not.toContain("celeste")` (`:557`) does — pins the stricter code, so it would fail the day
   * exclusion is legitimately softened into a heavy penalty. A rank comparison holds under both.
   *
   * Why this is not tautological: `statusPenalty` gives `completed_100` a **0** in new modes
   * (`recommendation.ts:115`) — the *best* possible penalty, identical to `played`. `isEligible` is
   * the only thing keeping it out of the ranking. Relax that filter and the two entries below score
   * exactly equal, at which point the tie-break decides — and the fixture hands the
   * tie-break-favoured position (older `created_at`, smaller `id`) to the 100%-complete entry. So a
   * relaxed filter puts it *first*, and this assertion fails. Only real de-prioritization holds it.
   */
  it("never lets a 100%-complete game outrank a comparable played one in a new mode", () => {
    const comparable = (id: string, status: PlayStatus, createdAt: string) =>
      entry({
        id,
        play_status: status,
        created_at: createdAt,
        // Every other scoring axis held equal: same bucket, same release date, same purchase date,
        // so length distance and novelty rank tie in both new modes and only status can separate.
        length_hours: 20,
        release_date: "2021-01-01",
        date_bought: "2026-01-01",
      });
    const hundredPercent = comparable("aaa-100pct", "completed_100", "2026-01-01T00:00:00Z");
    const played = comparable("zzz-played", "played", "2026-06-01T00:00:00Z");

    for (const mode of NEW_MODES) {
      const order = ids(recommend([hundredPercent, played], req(mode)));
      expect(order).toContain("zzz-played");
      expect(rankOf(order, "aaa-100pct")).toBeGreaterThan(rankOf(order, "zzz-played"));
    }
  });
});

describe("recommend — determinism across input permutations (full result)", () => {
  /**
   * Oracle: US-03 AC (`prd.md:84`) and §Business Logic (`prd.md:182`) — "identical inputs produce
   * identical outputs (no randomness in v1)", so re-asking "will not capriciously reshuffle
   * results". The PRD mandates determinism; it does **not** mandate `created_at` → `id` as the key,
   * so nothing here asserts that key (the existing `:440-464` test keeps documenting it).
   *
   * Two things this catches that the existing single reversed-input, ids-only check (`:434-438`)
   * cannot: a refactor leaning on `Array.prototype.sort` stability instead of the explicit total
   * order — stability preserves *input* order, so a two-permutation check can pass while a third
   * diverges — and score-level nondeterminism, invisible to an ids-only comparison.
   *
   * The tie is a **triple**, not a pair, and its `created_at` values are chosen so that *both*
   * tie-break branches decide a real comparison (Phase 4 mutation pass). A comparator that loses
   * antisymmetry — `cmp(a,b) === cmp(b,a) === -1`, i.e. either branch at `recommendation.ts:201`
   * or `:204` degrading to a constant `-1` — makes `Array.sort` return an order that depends on
   * where the tied entries sat in the input, precisely the nondeterminism `prd.md:182` forbids.
   * Each branch is only *entered* under its own condition (`:201` when `created_at` differs, `:204`
   * when it matches), so a fixture whose ties agree on `created_at` probes one and blinds the
   * other. This does not assert `created_at` → `id` *is* the tie-break key — that stays Oracle
   * Hazard #4, documented by `:440-464` — only that whatever key is used yields one stable order.
   */
  const library = [
    // Three entries identical on every scoring axis in every mode ⇒ a genuine score tie. `created_at`
    // is not a scoring axis for any of them: all three set `date_bought`, so the `newly_bought`
    // novelty term never falls back to `created_at` and the scores stay exactly equal.
    // tie-a/tie-b share a created_at ⇒ the `id` branch separates them;
    // tie-c differs ⇒ the `created_at` branch separates it from both.
    entry({
      id: "tie-a",
      play_status: "played",
      length_hours: 20,
      release_date: "2021-01-01",
      date_bought: "2026-02-01",
      created_at: "2026-01-01T00:00:00Z",
    }),
    entry({
      id: "tie-b",
      play_status: "played",
      length_hours: 20,
      release_date: "2021-01-01",
      date_bought: "2026-02-01",
      created_at: "2026-01-01T00:00:00Z",
    }),
    entry({
      id: "tie-c",
      play_status: "played",
      length_hours: 20,
      release_date: "2021-01-01",
      date_bought: "2026-02-01",
      created_at: "2026-04-01T00:00:00Z",
    }),
    // ...and three that differ on length, status and both date axes ⇒ genuine score distinctions.
    entry({
      id: "distinct-playing",
      play_status: "playing_now",
      length_hours: 20,
      release_date: "2019-01-01",
      date_bought: "2026-03-01",
    }),
    entry({
      id: "distinct-short",
      play_status: "completed",
      length_hours: 5,
      release_date: "2023-01-01",
      date_bought: "2026-01-15",
    }),
    entry({
      id: "distinct-unbucketed",
      play_status: "played",
      length_hours: null,
      release_date: "2015-01-01",
      date_bought: "2026-05-01",
    }),
  ];
  // Fixed, hand-written permutations — three distinct reorderings plus the original.
  const PERMUTATIONS = [
    [0, 1, 2, 3, 4, 5],
    [5, 4, 3, 2, 1, 0],
    [2, 0, 4, 1, 5, 3],
    [1, 5, 0, 3, 2, 4],
  ];

  it("returns a deep-equal result — items and scores — across permutations, in every mode", () => {
    for (const mode of NOVELTY_MODES) {
      const results = PERMUTATIONS.map((order) =>
        recommend(
          order.map((i) => library[i]),
          req(mode),
        ),
      );

      // Guard the fixture itself: if it ever lost its ties (or its distinctions) the assertion
      // below would still pass while no longer probing the region where ordering can wobble.
      const scores = results[0].status === "ranked" ? results[0].items.map((item) => item.score) : [];
      expect(new Set(scores).size).toBeLessThan(scores.length);
      expect(new Set(scores).size).toBeGreaterThan(1);

      for (const result of results.slice(1)) {
        expect(result).toEqual(results[0]);
      }
    }
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

  /**
   * **Documentation-of-behaviour, not spec.** The PRD mandates determinism (`prd.md:84`) but never
   * names an ordering key, so a future change to the tie-break would be legitimate and should
   * re-take this test rather than be blocked by it — the same status the 30h bucket edge carries at
   * `:98-127`. Determinism *itself* is asserted spec-side by the permutation suite at `:322-425`.
   *
   * The fixture is built so each branch decides a comparison the other cannot (Phase 4 mutation
   * pass — the previous fixture had its `created_at` order agree with its `id` order, so dropping
   * the `created_at` branch entirely still produced the expected output and the test verified only
   * half its name):
   * - `c` is the oldest ⇒ the `created_at` branch alone lifts it above `a`/`b`, whose ids both sort
   *   lower. Drop that branch and the result becomes `a,b,c`.
   * - `a` and `b` share a `created_at` ⇒ only the `id` branch separates them, and they are fed in
   *   `b,a` order so a stable sort cannot fake it. Drop that branch and the result becomes `c,b,a`.
   */
  it("breaks score ties by created_at ascending, then id ascending", () => {
    // Identical scoring inputs (in-bucket, same status, same date) ⇒ equal score ⇒ tie-break only.
    const tie = (id: string, created_at: string) =>
      entry({ id, created_at, play_status: "not_played", length_hours: 20, release_date: "2021-01-01" });
    const result = recommend(
      [tie("c", "2026-01-01T00:00:00Z"), tie("b", "2026-01-03T00:00:00Z"), tie("a", "2026-01-03T00:00:00Z")],
      req("new_releases"),
    );
    expect(ids(result)).toEqual(["c", "a", "b"]);
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
