/*
 * Agentic PR review — the entry point the composite action invokes.
 *
 * Assembles the inputs, runs `packages/code-reviewer` once against this repo's rubric, renders a
 * comment, and sets the exit code. All of this repository's review *policy* lives under
 * `scripts/pr-review/`; the package itself stays a generic reviewer that knows a review has scored
 * criteria but not which five.
 *
 *   node scripts/pr-review.mjs --out comment.md     # live review, needs OPENROUTER_API_KEY
 *   node scripts/pr-review.mjs --dry-run            # offline: filtering + prompt shape, no model
 *
 * Every pull-request-derived value arrives through the **environment**, never argv. A PR title is
 * attacker-controlled text even from a collaborator, and a title of `--out /etc/passwd` must not be
 * parseable as a flag. The calling workflow completes the other half of that defence by passing
 * these through `env:` rather than interpolating `${{ }}` into a `run:` body.
 *
 * Environment:
 *   BASE_SHA, HEAD_SHA        required — `github.event.pull_request.{base,head}.sha`
 *   PR_TITLE, PR_BODY         optional — the author's own words
 *   OPENROUTER_API_KEY        required for a live run; unused by --dry-run
 *   OPENROUTER_MODEL          optional — pinned by the action, not left to the package default
 *   MAX_PRICE_PROMPT          optional — OpenRouter per-request price cap, USD per million tokens
 *   MAX_PRICE_COMPLETION      optional — likewise, for completion tokens
 *
 * Exit codes: 0 passed, 1 failed (including "the review did not complete"), 2 wiring error.
 * An incomplete review is deliberately a failure — "we did not find out" and "we looked and it was
 * fine" are different states, and only one of them should let a merge through.
 *
 * --dry-run imports nothing from the package and constructs no model, so it runs offline, with no
 * key, and on a checkout where `packages/code-reviewer/dist` was never built.
 */

import { writeFileSync } from "node:fs";
import { REVIEW_RUBRIC } from "./pr-review/rubric.mjs";
import { collectInputs } from "./pr-review/inputs.mjs";
import { deriveVerdict } from "./pr-review/verdict.mjs";
import { renderComment, renderIncompleteComment, renderProseOnlyComment } from "./pr-review/comment.mjs";

/** Resolved from this file, so the script works regardless of the caller's cwd. */
const PACKAGE_ENTRY = new URL("../packages/code-reviewer/dist/index.js", import.meta.url);

/*
 * Pinned, because the caller thresholds the scores and the threshold sits inside the range where
 * the model's own variance lives. Two runs against an identical diff returned 4 and 2 for
 * `test-falsifiability` — same substance, different digit — and the gate is at 3, so the same
 * commit both passed and failed (runs 34159218589 and 34159617713; see calibration.md).
 *
 * This does not buy determinism and should not be read as buying it: OpenRouter may route the same
 * model id to a different provider between runs, which is its own source of drift. It removes the
 * one source of variance that is ours to remove. The rubric's decision-band section is the more
 * robust half of the fix — it narrows the range the model is choosing within, rather than only
 * making the choice less random.
 */
const REVIEW_TEMPERATURE = 0;

function parseArgs(argv) {
  const args = { out: undefined, dryRun: false };

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") {
      args.dryRun = true;
    } else if (argv[i] === "--out") {
      args.out = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown argument ${JSON.stringify(argv[i])}. Usage: pr-review.mjs [--out <path>] [--dry-run]`);
    }
  }

  return args;
}

/** A price cap only makes it into the request when it is a real number; an empty env var is "unset". */
function parsePrice(value) {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive number for a max_price cap, got ${JSON.stringify(value)}.`);
  }
  return parsed;
}

function buildProviderOptions(env) {
  const prompt = parsePrice(env.MAX_PRICE_PROMPT);
  const completion = parsePrice(env.MAX_PRICE_COMPLETION);
  if (prompt === undefined && completion === undefined) return undefined;

  return {
    max_price: {
      ...(prompt === undefined ? {} : { prompt }),
      ...(completion === undefined ? {} : { completion }),
    },
  };
}

/** Writes the comment when the caller asked for one, and says where it went. */
function emitComment(body, outPath) {
  if (outPath === undefined) {
    console.log("\n--- comment (no --out given, printed instead) ---\n");
    console.log(body);
    return;
  }
  writeFileSync(outPath, `${body}\n`, "utf8");
  console.log(`Comment written to ${outPath}`);
}

function printDryRun({ title, body, paths, diff, excluded, changedCount, truncated }) {
  console.log("=== rubric (extraInstructions) ===\n");
  console.log(REVIEW_RUBRIC);
  console.log("\n=== review request ===\n");
  console.log(`Title:\n${title || "(none)"}\n`);
  console.log(`Description:\n${body || "(none)"}\n`);
  console.log(`Paths under review (${String(paths.length)} of ${String(changedCount)} changed):`);
  for (const path of paths) console.log(`- ${path}`);
  console.log(`\nExcluded as prose/generated (${String(excluded.length)}):`);
  for (const path of excluded) console.log(`- ${path}`);
  console.log(
    `\nDiff: ${String(diff.length)} characters${truncated ? " (TRUNCATED)" : ""}. ` +
      `The package composes title, description, path list and diff — diff last — into the final prompt.`,
  );
  console.log("\nNo model constructed, no network call made.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = process.env;

  const baseSha = env.BASE_SHA;
  const headSha = env.HEAD_SHA;
  if (!baseSha || !headSha) {
    console.error("BASE_SHA and HEAD_SHA are required (from github.event.pull_request.{base,head}.sha).");
    return 2;
  }

  const title = env.PR_TITLE ?? "";
  const body = env.PR_BODY ?? "";
  const { paths, diff, excluded, changedCount, truncated } = collectInputs({ baseSha, headSha });

  if (args.dryRun) {
    printDryRun({ title, body, paths, diff, excluded, changedCount, truncated });
    return 0;
  }

  // Nothing scoreable in the diff: no model, no cost, and no verdict to argue about.
  if (paths.length === 0) {
    emitComment(renderProseOnlyComment({ headSha, changedCount }), args.out);
    console.log("verdict=passed");
    return 0;
  }

  let pkg;
  try {
    pkg = await import(PACKAGE_ENTRY.href);
  } catch (error) {
    console.error(
      `Could not load packages/code-reviewer. Run \`npm ci && npm run build\` in packages/code-reviewer first.\n${String(error)}`,
    );
    return 2;
  }
  const { ReviewError, createModel, loadConfig, reviewCode } = pkg;

  let review;
  try {
    const config = loadConfig(env);
    const provider = buildProviderOptions(env);
    const model = createModel(config, provider ? { provider } : {});

    review = await reviewCode({
      model,
      rootDir: process.cwd(),
      paths,
      title,
      description: body,
      diff,
      extraInstructions: REVIEW_RUBRIC,
      temperature: REVIEW_TEMPERATURE,
    });
  } catch (error) {
    const reason =
      error instanceof ReviewError && error.code === "step-budget-exhausted"
        ? "The agent used its entire step budget without producing a verdict."
        : "The review run failed before producing a verdict.";
    // stderr, never the comment. This is the raw error off the provider call, and the comment is
    // posted publicly; the run log is the right place for it and masks repository secrets. stderr
    // also keeps the `verdict=` line the last thing on STDOUT, which the composite action's
    // anchored `tail -n 1` depends on.
    console.error(`Review run failed:\n${String(error.stack ?? error.message ?? error)}`);
    emitComment(renderIncompleteComment({ headSha, reason }), args.out);
    console.log("verdict=failed");
    return 1;
  }

  // A criteria set that is not exactly the five the rubric asked for is a failed review, not a
  // passing one: the criterion a model drops is the one it had least to say about.
  let verdict;
  let reasons;
  try {
    ({ verdict, reasons } = deriveVerdict(review.criteria));
  } catch (error) {
    // Same rule as above. `deriveVerdict`'s messages are this repository's own prose, but they
    // interpolate the criterion ids the MODEL returned, so the text is still partly model-authored
    // and does not belong in a public comment.
    console.error(`Verdict derivation failed:\n${String(error.stack ?? error.message ?? error)}`);
    emitComment(
      renderIncompleteComment({
        headSha,
        reason: "The review returned an incomplete or unrecognised set of criteria.",
      }),
      args.out,
    );
    console.log("verdict=failed");
    return 1;
  }

  emitComment(
    renderComment({ headSha, verdict, reasons, review, paths, excludedCount: excluded.length, truncated }),
    args.out,
  );
  console.log(`verdict=${verdict}`);
  return verdict === "failed" ? 1 : 0;
}

process.exitCode = await main();
