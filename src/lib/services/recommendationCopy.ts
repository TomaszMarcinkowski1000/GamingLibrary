import type { RecommendationResult } from "@/types";

/**
 * User-facing copy for the recommender's empty-state (PRD US-03 AC, §Business Logic).
 *
 * The engine (`recommend()`) emits only a *machine* reason — and `EmptyReason` has just two
 * values, so `mode_eligibility` conflates two distinct constraints: "comfort needs a game you've
 * played" and "everything matching is already 100% complete". The `mode` field is what
 * disambiguates them, and this function is the only place that does so.
 *
 * That makes this module the layer where the PRD's actual promise lands: the empty state "names
 * which constraint excluded everything, not an empty list". It lives in `src/lib/services/`
 * rather than beside the page because a `.ts` file under `src/pages/` would become an Astro
 * endpoint route, and because `.astro` frontmatter is not importable by the unit harness.
 */

/** Human sentence naming the binding constraint and a suggested relaxation (PRD US-03). */
export function emptyStateMessage(empty: Extract<RecommendationResult, { status: "empty" }>): string {
  if (empty.reason === "empty_library") {
    return "Your library is empty — add a game first.";
  }
  if (empty.mode === "comfort") {
    return "Comfort mode needs games you’ve played — you have none yet. Try “new releases”, or mark a game as played.";
  }
  return "Every game matching is already 100% completed — try comfort mode.";
}
