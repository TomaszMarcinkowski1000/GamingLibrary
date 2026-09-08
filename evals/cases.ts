/*
 * promptfoo test generator: one committed case folder becomes one test.
 *
 * Loaded as `tests: file://cases.ts:generate` — the `:functionName` suffix IS supported for test
 * generators, unlike for providers. Generating the tests rather than writing them into the YAML
 * keeps `case.json` the single statement of what is planted in the fixture; the config never
 * restates what the answer key already says.
 *
 * `vars` carries the case *identity* and nothing else. That is not minimalism, it is the shape
 * promptfoo's var handling forces, and both halves were observed the first time this ran:
 *
 *   1. An array-valued var is a test MATRIX, not a value. Putting `flaws` and `decoys` in vars
 *      turned one case into three cells, each holding one flaw zipped against one decoy.
 *   2. String vars are rendered through nunjucks. The fixture's diff legitimately contains `{{` —
 *      it is part of the planted `dangerouslySetInnerHTML={{ __html: ... }}` line — so inlining
 *      the diff as a var failed the whole run with `expected variable end` at exactly that line.
 *
 * So the case travels as an id, and everything that needs the case reads it off disk through
 * `loadCase`: the provider for the run, the assertions for the answer key. The fixture is
 * committed and adjacent; nothing is lost by not copying it through the report.
 */
import type { TestCase } from "promptfoo";
import { loadCase } from "./case.ts";

/** The cases this harness ships. One, deliberately — see `evals/README.md`. */
const CASE_IDS = ["react-19-migration"] as const;

export function generate(): TestCase[] {
  return CASE_IDS.map((caseId) => {
    // Loaded here so a malformed answer key fails before any model is called, not per-cell.
    const { answerKey } = loadCase(caseId);

    return {
      description: `${caseId}: ${answerKey.title}`,
      vars: { caseId },
    };
  });
}
