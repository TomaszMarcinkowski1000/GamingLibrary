/*
 * The deterministic half of the measurement.
 *
 * The split, settled during planning: what is objectively checkable **gates**; what is a
 * judgement call is **measured**. Everything in this file is the first kind — schema validity, the
 * five-criterion contract, the derived verdict, finding severity — so each one hard-fails a cell
 * and none of them needs a model. Per-flaw recall and decoy precision are LLM-graded and live in
 * the config as named metrics.
 *
 * Each function returns a `GradingResult` rather than a bare boolean so a red cell says *why* in
 * the report instead of "Custom function returned false".
 *
 * These are loaded as `file://assertions.ts:<name>` and called with `(output, context)`, where
 * `output` is the already-parsed `Review` the provider returned — not a JSON string.
 */
import type { AssertionValueFunctionContext, GradingResult } from "promptfoo";
import { deriveVerdict } from "../scripts/pr-review/verdict.mjs";
import { loadCase } from "./case.ts";
import { loadReviewer } from "./reviewer.ts";
import type { Review } from "./reviewer.ts";

function fail(reason: string): GradingResult {
  return { pass: false, score: 0, reason };
}

function pass(reason: string): GradingResult {
  return { pass: true, score: 1, reason };
}

/**
 * Narrows promptfoo's untyped assertion output.
 *
 * A cell that errored never reaches an assertion, so anything that is not a review object here is
 * a provider bug rather than a model failure — and it should say so rather than fail as if the
 * model had answered badly.
 */
function asReview(output: unknown): Review | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const candidate = output as Partial<Review>;
  return Array.isArray(candidate.criteria) && Array.isArray(candidate.findings) ? (candidate as Review) : undefined;
}

/** File paths cross the boundary as model-authored text; compare them leniently but not blindly. */
function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function citesSameFile(findingFile: string, expectedFile: string): boolean {
  const finding = normalizePath(findingFile);
  const expected = normalizePath(expectedFile);
  return finding === expected || finding.endsWith(`/${expected}`) || expected.endsWith(`/${finding}`);
}

/**
 * The files the answer key plants defects in.
 *
 * Read off disk rather than out of `vars` because promptfoo treats an array-valued var as a test
 * matrix: carrying `flaws` through vars silently turned one case into one cell per flaw. See the
 * header of `evals/cases.ts`. The id is all that travels.
 */
function flawFiles(context: AssertionValueFunctionContext): string[] {
  const caseId: unknown = context.vars.caseId;
  if (typeof caseId !== "string" || caseId === "") return [];
  return loadCase(caseId).answerKey.flaws.map((flaw) => flaw.file);
}

/**
 * (1) The review validates against the package's own `reviewSchema`.
 *
 * The package already validates before returning, so this is a second reading of the same
 * contract — and that is the point: it is the assertion that fails first and loudest if the
 * provider ever starts handing promptfoo something other than a `Review`.
 */
export async function assertSchemaValid(output: unknown): Promise<GradingResult> {
  const { reviewSchema } = await loadReviewer();
  const parsed = reviewSchema.safeParse(output);
  if (parsed.success) return pass("Output validates against reviewSchema.");

  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  return fail(`Output does not validate against reviewSchema:\n${issues.join("\n")}`);
}

/**
 * (2) The five-criterion completeness contract holds.
 *
 * `deriveVerdict` throws on a criteria set that is not exactly the five the rubric asked for
 * (`scripts/pr-review/verdict.mjs:45-68`). That is a distinct failure mode from a low score:
 * schema-valid output that is policy-invalid, which in production means the review does not get a
 * verdict at all. Worth its own red.
 */
export function assertCriteriaContract(output: unknown): GradingResult {
  const review = asReview(output);
  if (review === undefined) return fail("Provider did not return a review object.");

  try {
    deriveVerdict(review.criteria);
  } catch (error: unknown) {
    return fail(`deriveVerdict rejected the criteria set: ${error instanceof Error ? error.message : String(error)}`);
  }
  return pass(`All ${String(review.criteria.length)} criteria are exactly the five the rubric asked for.`);
}

/**
 * (3) The derived verdict is `failed` — this change must not merge.
 *
 * Note what this does and does not say. It will most likely fire because a behavioural migration
 * ships no tests, and `test-falsifiability` is the rubric's hard blocker — not because the model
 * caught a React 19 defect. It is a real assertion about what CI would do with this PR, and it is
 * deliberately NOT the flaw-recall measurement; that is graded separately, per flaw.
 */
export function assertVerdictFailed(output: unknown): GradingResult {
  const review = asReview(output);
  if (review === undefined) return fail("Provider did not return a review object.");

  let derived;
  try {
    derived = deriveVerdict(review.criteria);
  } catch (error: unknown) {
    return fail(`deriveVerdict threw: ${error instanceof Error ? error.message : String(error)}`);
  }

  const scores = review.criteria.map((criterion) => `${criterion.id}=${String(criterion.score)}`).join(" ");
  return derived.verdict === "failed"
    ? pass(`Verdict failed. ${derived.reasons.join(" ")}`)
    : fail(`Verdict passed, but this change must not merge. Scores: ${scores}`);
}

/**
 * (4) At least one `major`/`critical` finding anchored to the file the defects are planted in.
 *
 * The weakest possible statement of "the review engaged with the change": it says nothing about
 * *which* defect was found, only that the reviewer filed something serious against the file that
 * carries them. A model that returns five criterion scores and an empty `findings` array is
 * schema-valid, policy-valid, and useless.
 */
export function assertSeriousFindingOnFlawFile(output: unknown, context: AssertionValueFunctionContext): GradingResult {
  const review = asReview(output);
  if (review === undefined) return fail("Provider did not return a review object.");

  const expected = flawFiles(context);
  if (expected.length === 0) return fail("The test case carries no usable `caseId` var; evals/cases.ts sets it.");

  const serious = review.findings.filter((finding) => finding.severity === "major" || finding.severity === "critical");
  const onFlawFile = serious.filter((finding) => expected.some((file) => citesSameFile(finding.file, file)));

  if (onFlawFile.length > 0) {
    return pass(
      `${String(onFlawFile.length)} major/critical finding(s) on ${[...new Set(expected)].join(", ")}: ` +
        onFlawFile.map((finding) => `${finding.file}:${String(finding.line)} ${finding.title}`).join(" | "),
    );
  }

  return fail(
    `No major/critical finding on ${[...new Set(expected)].join(", ")}. ` +
      `Review filed ${String(review.findings.length)} finding(s): ` +
      (review.findings.map((finding) => `${finding.severity} ${finding.file}:${String(finding.line)}`).join(" | ") ||
        "(none)"),
  );
}
