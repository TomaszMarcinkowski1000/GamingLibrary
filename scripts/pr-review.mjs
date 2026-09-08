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
 * Sampling temperature, and by default UNSET — which is not the obvious choice, so here is why.
 *
 * It was briefly pinned to 0 to fight the scoring instability that motivated this phase (runs 1 and
 * 2 returned 4 and 2 for `test-falsifiability` on an identical diff, either side of the gate at 3).
 * On `anthropic/claude-sonnet-5` that cannot work: **not one of its nine OpenRouter endpoints
 * declares `temperature` support.** Sending it is therefore either silently dropped, or — together
 * with `require_parameters: true` below — excludes every endpoint and fails the request outright
 * with "No endpoints found that can handle the requested parameters". Run 6 did exactly that, in 14
 * seconds.
 *
 * So the rubric's decision-band section is not merely the more robust half of the stability fix on
 * this model; it is the whole of it. Do not reintroduce a temperature pin here expecting it to
 * help — check `GET /api/v1/models/<id>/endpoints` for `temperature` in `supported_parameters`
 * first. The plumbing stays because it is real and a different model may honour it.
 */
function parseTemperature(env) {
  const raw = env.REVIEW_TEMPERATURE;
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a number for REVIEW_TEMPERATURE, got ${JSON.stringify(raw)}.`);
  }
  return parsed;
}

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

/*
 * Whether the request demands strict `json_schema` enforcement from the provider. Defaults to true,
 * matching both the provider's own default and the configuration under which runs 1 and 2 completed
 * — so leaving this unset changes nothing.
 *
 * It exists because strict enforcement at the END of a 20-step tool loop is the specific thing
 * cheaper models have failed here (calibration.md runs 3 and 4). Relaxing it does not relax the
 * result: the object is still validated against `reviewSchema` inside the package, so a malformed
 * review fails there rather than reaching the comment.
 */
function parseStrict(env) {
  return env.STRUCTURED_OUTPUT_STRICT !== "false";
}

function buildProviderOptions(env) {
  const prompt = parsePrice(env.MAX_PRICE_PROMPT);
  const completion = parsePrice(env.MAX_PRICE_COMPLETION);

  return {
    /*
     * Load-bearing, and NOT merely a nicety. OpenRouter serves one model id from several
     * independent endpoints, and they do not all support the same parameters. `z-ai/glm-4.7` has
     * seven; three of them (Novita, Z.AI, Mancer 2) cannot do `structured_outputs` at all. This
     * defaults to FALSE, so without it OpenRouter is free to route a request carrying a
     * `response_format: json_schema` to an endpoint that will simply ignore it — and the AI SDK
     * sends `response_format` and `tools` in the same request, so both have to be supported.
     *
     * That is not hypothetical: run 3 (see calibration.md) burned 160k output tokens over 9m41s
     * and returned no object, because it landed on an endpoint that could not produce one.
     *
     * Note that the model-level `supported_parameters` in `GET /api/v1/models` is the UNION across
     * a model's endpoints, not a guarantee about the one you get. Checking it tells you some
     * endpoint can do the job; this flag is what makes sure yours does.
     *
     * The cost of this flag: it filters on EVERY parameter in the request, not only the ones you
     * care about, so adding an innocuous option can empty the eligible set and fail the request
     * with "No endpoints found that can handle the requested parameters". That is what a
     * `temperature` pin did to Sonnet in run 6 — none of its nine endpoints declares `temperature`
     * — in 14 seconds, before a single token. Before adding any option to this request, check it
     * against `GET /api/v1/models/<id>/endpoints`.
     */
    require_parameters: true,
    ...(prompt === undefined && completion === undefined
      ? {}
      : {
          max_price: {
            ...(prompt === undefined ? {} : { prompt }),
            ...(completion === undefined ? {} : { completion }),
          },
        }),
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
  const { paths, deleted, diff, excluded, changedCount, truncated } = collectInputs({ baseSha, headSha });

  if (args.dryRun) {
    printDryRun({ title, body, paths, diff, excluded, changedCount, truncated });
    return 0;
  }

  // Nothing scoreable in the diff: no model, no cost, and no verdict to argue about.
  //
  // `deleted` is load-bearing here, not decoration. `paths` drops deletions because the agent
  // cannot open a file that is gone — so a PR that ONLY deletes code leaves `paths` empty while
  // having changed plenty. Testing `paths.length` alone auto-passed exactly that PR: no model call,
  // `ai-cr:passed`, and a comment asserting every changed path was documentation. Deleting a test
  // file, an RLS migration, or a route handler sailed through the gate. Found by the reviewer
  // reviewing itself (calibration.md run 8) and reproduced against a synthetic deletion-only range.
  //
  // A deletion-only change still gets a real review: `paths` is empty, but the diff carries the
  // removal and that is what the agent scores.
  if (paths.length === 0 && deleted.length === 0) {
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
    const temperature = parseTemperature(env);
    // Always present now: `require_parameters` is unconditional, so there is no longer a case
    // where this review wants no provider routing at all.
    const model = createModel(config, { provider, structuredOutputs: { strict: parseStrict(env) } });

    review = await reviewCode({
      model,
      rootDir: process.cwd(),
      paths,
      title,
      description: body,
      diff,
      extraInstructions: REVIEW_RUBRIC,
      ...(temperature === undefined ? {} : { temperature }),
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
