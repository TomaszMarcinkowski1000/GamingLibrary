/*
 * The pass/fail rule, as a pure function of the scores the model returned.
 *
 * Deriving the verdict here rather than asking the model for it is deliberate: the rule becomes
 * un-forgeable by prompt injection (nothing in a PR's diff can talk this function into "passed"),
 * and a reader of the posted comment can re-derive the verdict from the table above it.
 *
 * The rule itself is the one signed off in `requirements.md` § "Open — needs a decision":
 * `test-falsifiability` is the hard blocker at <= 3; every other criterion fails at <= 2.
 */

import { CRITERION_IDS } from "./rubric.mjs";

/** The blocking criterion and its threshold — a low score here fails the PR on its own. */
const HARD_BLOCKER_ID = "test-falsifiability";
const HARD_BLOCKER_MAX_FAIL = 3;

/** Every other criterion fails only at the bottom of the scale. */
const OTHER_MAX_FAIL = 2;

/**
 * The rule in one line, rendered into the comment beside the verdict so the reader never has to
 * take the label on trust.
 */
export const VERDICT_RULE =
  `\`${HARD_BLOCKER_ID}\` at ${HARD_BLOCKER_MAX_FAIL} or below fails on its own; ` +
  `any other criterion at ${OTHER_MAX_FAIL} or below fails; otherwise passed.`;

/** The score at or below which this criterion fails. */
function failThreshold(id) {
  return id === HARD_BLOCKER_ID ? HARD_BLOCKER_MAX_FAIL : OTHER_MAX_FAIL;
}

/**
 * Turns the model's scored criteria into a verdict.
 *
 * Throws rather than returning a verdict when the criteria set is not exactly the five the rubric
 * asked for. A model that returns four of five must not silently become a green check: the missing
 * one is precisely the one it had the least to say about, and "absent" is the failure mode that
 * looks most like a pass.
 *
 * @param {{ id: string, score: number, rationale: string }[]} criteria
 * @returns {{ verdict: "passed" | "failed", reasons: string[] }}
 */
export function deriveVerdict(criteria) {
  if (!Array.isArray(criteria)) {
    throw new Error("The review returned no `criteria` array.");
  }

  const seen = new Map();
  for (const entry of criteria) {
    if (!CRITERION_IDS.includes(entry.id)) {
      throw new Error(
        `The review returned an unrecognised criterion id ${JSON.stringify(entry.id)}. Expected one of: ${CRITERION_IDS.join(", ")}.`,
      );
    }
    if (seen.has(entry.id)) {
      throw new Error(`The review returned criterion ${JSON.stringify(entry.id)} more than once.`);
    }
    seen.set(entry.id, entry);
  }

  const missing = CRITERION_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(
      `The review is missing ${String(missing.length)} of ${String(CRITERION_IDS.length)} criteria: ${missing.join(", ")}.`,
    );
  }

  const reasons = [];
  for (const id of CRITERION_IDS) {
    const { score } = seen.get(id);
    const threshold = failThreshold(id);
    if (score <= threshold) {
      reasons.push(
        id === HARD_BLOCKER_ID
          ? `\`${id}\` scored ${String(score)} — the hard blocker fails at ${String(threshold)} or below.`
          : `\`${id}\` scored ${String(score)} — fails at ${String(threshold)} or below.`,
      );
    }
  }

  return { verdict: reasons.length > 0 ? "failed" : "passed", reasons };
}
