/*
 * promptfoo test generator: one committed case folder becomes one test.
 *
 * Loaded as `tests: file://cases.ts:generate` — the `:functionName` suffix IS supported for test
 * generators, unlike for providers. Generating the tests rather than writing them into the YAML
 * keeps `case.json` the single statement of what is planted in the fixture; the config never
 * restates what the answer key already says. That is why the judged assertions are built here
 * rather than in `promptfooconfig.yaml`: the rubrics ARE the answer key, rendered as prose.
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
import type { Assertion, AssertionSet, TestCase } from "promptfoo";
import type { Decoy, Flaw } from "./case.ts";
import { loadCase } from "./case.ts";

/** The cases this harness ships. One, deliberately — see `evals/README.md`. */
const CASE_IDS = ["react-19-migration"] as const;

/**
 * The metric name of the per-cell recall rollup.
 *
 * It is the assert-set's own metric rather than a `derivedMetrics` entry, which is what the plan
 * originally specified. `derivedMetrics` evaluates its expression with **mathjs**, where `-` is
 * subtraction — so `flaw-default-prop-ignored + flaw-effect-teardown-lost` parses as arithmetic on
 * an undefined symbol `flaw`, throws, and promptfoo swallows the throw at debug level and leaves
 * the metric sitting at 0. Silent, and indistinguishable from a model that found nothing.
 *
 * An assert-set carries the same number for free: promptfoo scores the set as the mean of its
 * children and files that under the set's `metric`, so this is recall in 0..1 rather than 0..3.
 * It also stays in sync by construction — the config never has to name the flaws.
 */
const RECALL_METRIC = "flaw-recall";

/** The decoy metric. Unlike the flaw metrics this one gates; see `decoyPrecisionAssertion`. */
const PRECISION_METRIC = "precision";

/**
 * The recall bar a cell must clear: **two of the three planted defects**, diagnosed.
 *
 * Empirical, from the `--repeat 3` sweep of 2026-09-09 (`context/changes/cr-evals/baseline.md`).
 * Nine cells produced exactly three distinct recall values, and they are not close together:
 *
 *   deepseek-v4-flash   0.33  0.33  0.33
 *   glm-5.1             0.00  0.33  0.00
 *   claude-sonnet-5     1.00  1.00  1.00
 *
 * So the observed data has one wide empty band, 0.33 → 1.00, and this number sits in the middle of
 * it. That placement is the point: a bar inside a gap is robust to run-to-run drift on either side,
 * where one pinned just above 0.33 would flip on the first cheap-model lucky guess and one pinned
 * at 1.00 would fail Sonnet the first time it misses anything.
 *
 * It is also a policy statement and not only a fitted number: a reviewer that misses more than one
 * of three planted defects has not reviewed the change, whatever else it got right. Two of the
 * three cheap-model cells that clear the deterministic gates find exactly one defect and argue at
 * least one other away — that is the outcome this bar is drawn to reject.
 *
 * 0.66 rather than 0.67 so an exact two-of-three (0.666…) passes rather than failing by float.
 * Re-derive it when the corpus grows: a bar calibrated against one case is a bar about that case.
 */
const RECALL_BAR = 0.66;

/**
 * Wraps rubric prose so nunjucks hands it to the judge verbatim.
 *
 * promptfoo renders every string assertion `value` through nunjucks before grading
 * (`renderedValue = nunjucks.renderString(...)` in its evaluator), and these rubrics are built by
 * interpolating `case.json` prose that no one writes with a template engine in mind. The same
 * `{{` that took down the first run through `vars` would take down an assertion here. Nothing in
 * a rubric needs templating — every value is already substituted in TypeScript — so the whole
 * string opts out.
 */
function verbatim(rubric: string): string {
  return `{% raw %}\n${rubric.trim()}\n{% endraw %}`;
}

/**
 * What the judge is told the output is, shared by every rubric below.
 *
 * The "anywhere in the review" clause is a deliberate choice, not a hedge. A model that diagnoses
 * a defect correctly and then writes it into prose instead of `findings[]` has failed the output
 * contract — but that failure is ALREADY caught deterministically, by
 * `assertSeriousFindingOnFlawFile`. Scoring recall on `findings[]` alone would make the two
 * measurements say the same thing twice and throw away the interesting half: on the first sweep
 * `deepseek/deepseek-v4-flash` identified the XSS correctly and filed nothing (`evals/README.md`).
 * Keeping the gate on "used the contract" and the metric on "saw the bug" leaves them orthogonal.
 */
const OUTPUT_PREAMBLE = `
The output is a JSON code review of a pull request. It has a \`findings\` array (each entry has
file, line, severity, title and description), a \`criteria\` array of scored rubric criteria with
justifications, and a \`summary\` string.

Read ALL of it. A defect named anywhere in the review — in \`findings[]\`, in a criterion's
justification, or in \`summary\` — counts as identified. Whether the model used \`findings[]\`
properly is measured separately and is not your concern here.
`;

/**
 * One planted flaw, as a rubric.
 *
 * The bar is **this specific defect and its consequence**, not the API name. A model can name
 * every symbol on every changed line without having reviewed anything, and a rubric that accepted
 * a keyword match would score that as full recall.
 */
function flawRecallAssertion(flaw: Flaw): Assertion {
  const evidence =
    flaw.supportingEvidence === undefined
      ? ""
      : `\nWhere the consequence shows (NOT required to pass): ${flaw.supportingEvidence}`;

  return {
    type: "llm-rubric",
    metric: flaw.id,
    value: verbatim(`
${OUTPUT_PREAMBLE}
Decide whether the review identifies this specific defect:

  Location: ${flaw.file}, around line ${String(flaw.line)} (\`${flaw.anchor}\`)
  The defect: ${flaw.whatIsBroken}
  Why it matters: ${flaw.whyItMatters}${evidence}

PASS only if the review states, in substance, both what is broken and what goes wrong because of
it. The wording does not have to match, the severity does not have to agree, and the line does not
have to be right — a correct diagnosis attached to the wrong line is still a caught bug. Treat a
finding anchored far from line ${String(flaw.line)} as weaker evidence, not as a failure.

FAIL if the review only:
  - names the API, symbol, or line involved without saying what is wrong with it;
  - makes a generic observation that would apply to any migration of this kind;
  - recommends a change that would happen to remove the defect, without identifying the defect;
  - describes a different problem in the same file.

Score 1.0 when both the defect and its consequence are identified, 0.0 when the defect is not
identified at all, and 0.5 when the defect is identified but its consequence is not.
`),
  };
}

/**
 * The false-positive penalty, as one rubric over all three decoys.
 *
 * Recall alone rewards the model that flags everything, and that is the model you least want
 * gating merges — `context/archive/2026-09-07-ci-cd-code-review/calibration.md` records a false
 * positive among its two worst outcomes, alongside the false negative. This one **gates**: a
 * review that calls correct React 19 code a bug has failed at its job regardless of what else it
 * found.
 */
function decoyPrecisionAssertion(decoys: readonly Decoy[]): Assertion {
  const entries = decoys
    .map(
      (decoy, index) =>
        `  ${String(index + 1)}. ${decoy.file}, around line ${String(decoy.line)} (\`${decoy.anchor}\`)\n` +
        `     Why it is correct: ${decoy.whyItIsCorrect}`,
    )
    .join("\n\n");

  return {
    type: "llm-rubric",
    metric: PRECISION_METRIC,
    value: verbatim(`
${OUTPUT_PREAMBLE}
These changes in the pull request are CORRECT. Each justification below is verified against the
real repository, so treat it as fact rather than as a claim to be re-argued:

${entries}

PASS if the review reports none of them as a defect. FAIL if it reports any of them as a defect,
anywhere in the review.

"Reports as a defect" means asserting that the change is wrong, broken, unsupported, risky, a
regression, or that it must be reverted or fixed. It does NOT include:
  - describing the change neutrally, or approving of it;
  - asking for a test that covers the changed behaviour;
  - a stylistic preference stated as a preference.

Score 1.0 if none of the three is reported as a defect, and 0.0 if any of them is. Name which one
in your reason.
`),
  };
}

/**
 * The three flaw rubrics, grouped so the cell is judged on their **mean** rather than on each one
 * individually.
 *
 * `weight: 0` is the obvious way to make an assertion non-gating and it is the wrong one:
 * promptfoo normalises a named score by its accumulated weight, so a zero-weighted assertion
 * reports its metric as 0 no matter what the judge said. An assert-set with an explicit
 * `threshold` passes on `score >= threshold` instead of on "no child failed", which is what lets
 * one number decide the cell while every child metric still reaches the report.
 *
 * The threshold below is calibrated from observed data, not chosen a priori — see `RECALL_BAR`.
 */
function flawRecallAssertionSet(flaws: readonly Flaw[]): AssertionSet {
  return {
    type: "assert-set",
    metric: RECALL_METRIC,
    threshold: RECALL_BAR,
    assert: flaws.map(flawRecallAssertion),
  };
}

export function generate(): TestCase[] {
  return CASE_IDS.map((caseId) => {
    // Loaded here so a malformed answer key fails before any model is called, not per-cell.
    const { answerKey } = loadCase(caseId);

    return {
      description: `${caseId}: ${answerKey.title}`,
      vars: { caseId },
      // Concatenated after `defaultTest.assert`, not instead of it — the deterministic gates in
      // the config still apply to every cell.
      assert: [flawRecallAssertionSet(answerKey.flaws), decoyPrecisionAssertion(answerKey.decoys)],
    };
  });
}
