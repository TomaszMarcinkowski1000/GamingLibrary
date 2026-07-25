import { describe, expect, it } from "vitest";
import type { EmptyReason, NoveltyMode, RecommendationResult } from "@/types";
import { NOVELTY_MODES } from "@/types";
import { emptyStateMessage } from "./recommendationCopy";

/**
 * The oracle here is PRD §Business Logic (`prd.md:182`): the empty state "names which constraint
 * excluded everything, not an empty list" — a strictly stronger promise than US-03's
 * "explanatory empty-state" (`prd.md:85`).
 *
 * That promise cannot be proven at the engine level. `recommend()` returns a machine
 * `{reason, mode}`, and `EmptyReason` has only two values (`types.ts:162`), so
 * `mode_eligibility` **conflates two distinct constraints** — "comfort needs a game you've
 * played" and "everything matching is already 100% complete". Asserting the engine returned
 * `mode_eligibility` therefore says nothing about whether the user was told *which* constraint
 * bound. Only the copy layer can say that, so it is what gets asserted here.
 *
 * These tests assert **constraint vocabulary + pairwise distinctness**, never full-string
 * equality: a copy-paste mirror of the literals would break on any innocuous wording tweak while
 * proving nothing about meaning. The vocabulary matched ("empty" / "played" / "100%") is
 * traceable to the PRD's own words, not to the implementation's.
 *
 * Note what is *not* asserted: that this two-value-reason-plus-mode design is correct. It is a
 * recorded gap (see the plan's "What We're NOT Doing") — these tests prove the workaround works.
 */

const empty = (reason: EmptyReason, mode: NoveltyMode): Extract<RecommendationResult, { status: "empty" }> => ({
  status: "empty",
  reason,
  mode,
});

const NEW_MODES = NOVELTY_MODES.filter((mode) => mode !== "comfort");

describe("emptyStateMessage — names the binding constraint", () => {
  it("names the empty library when the library itself is empty", () => {
    const message = emptyStateMessage(empty("empty_library", "new_releases"));
    expect(message).toMatch(/library/i);
    expect(message).toMatch(/empty/i);
  });

  it("names the played-game requirement when comfort mode excluded everything", () => {
    const message = emptyStateMessage(empty("mode_eligibility", "comfort"));
    expect(message).toMatch(/comfort/i);
    expect(message).toMatch(/played/i);
    // The 100%-complete constraint is a *different* cause; naming it here would misinform.
    expect(message).not.toMatch(/100\s*%/);
  });

  it.each(NEW_MODES)("names the 100%%-complete constraint in the %s mode", (mode) => {
    const message = emptyStateMessage(empty("mode_eligibility", mode));
    expect(message).toMatch(/100\s*%/);
  });
});

describe("emptyStateMessage — the three causes are distinguishable", () => {
  /**
   * If two distinct exclusion causes produced the same sentence, the user could not tell which
   * constraint to relax — the PRD's "names which constraint" promise fails even though every
   * individual sentence still reads as explanatory. This is the assertion that catches a refactor
   * collapsing the branches into one generic "No recommendations found".
   */
  it("produces pairwise-distinct copy for empty-library, comfort, and 100%-complete", () => {
    const messages = [
      emptyStateMessage(empty("empty_library", "new_releases")),
      emptyStateMessage(empty("mode_eligibility", "comfort")),
      emptyStateMessage(empty("mode_eligibility", "new_releases")),
    ];
    expect(new Set(messages).size).toBe(messages.length);
  });

  /**
   * The comfort branch keys off `mode`, not `reason` — the seam the two-value `EmptyReason`
   * creates. Dropping that branch is a silent regression: the engine keeps returning a perfectly
   * correct `mode_eligibility` while every mode gets told about 100%-completion.
   */
  it("splits the conflated mode_eligibility reason by mode", () => {
    const comfort = emptyStateMessage(empty("mode_eligibility", "comfort"));
    for (const mode of NEW_MODES) {
      expect(emptyStateMessage(empty("mode_eligibility", mode))).not.toBe(comfort);
    }
  });

  it("never returns an empty or whitespace-only sentence", () => {
    for (const mode of NOVELTY_MODES) {
      for (const reason of ["empty_library", "mode_eligibility"] as const) {
        expect(emptyStateMessage(empty(reason, mode)).trim()).not.toBe("");
      }
    }
  });
});
