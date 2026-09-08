/*
 * promptfoo provider: one cell of the matrix is one full run of this repository's code reviewer.
 *
 * It reproduces the production call site (`scripts/pr-review.mjs:233-241`) — the same rubric as
 * `extraInstructions`, the same `require_parameters` routing, the same sandboxed `rootDir` — but
 * drives `createReviewAgent` + `agent.generate()` rather than `reviewCode`, so the run's step
 * count, tool calls, finish reason and token usage survive into the report. For a *model*
 * comparison those columns are half the answer: a model at a tenth of Sonnet's price is only
 * interesting alongside its price.
 *
 * promptfoo requires a **default-exported class** for a custom provider (`file://path.ts:Name` is
 * supported for test generators and assertion scripts, but not for providers), instantiated as
 * `new Provider({ ...providerOptions, id })`. Repeated entries pointing at this same file are
 * distinguished by `label` and `config.model`, and `id()` below keeps them distinct internally.
 *
 * The case identity travels in `context.vars`, not in the prompt string: promptfoo's `prompt`
 * argument is a poor fit for a `{ rootDir, paths, diff }` input, so it degrades to a case
 * descriptor here and the real input is read off the vars.
 */
import type { ApiProvider, CallApiContextParams, ProviderOptions, ProviderResponse } from "promptfoo";
import { REVIEW_RUBRIC } from "../../scripts/pr-review/rubric.mjs";
import { loadCase } from "../case.ts";
import { loadReviewer } from "../reviewer.ts";
import type { AgentStep, AgentToolCall, Review, RunUsage } from "../reviewer.ts";

/** Matches `DEFAULT_STEP_BUDGET` in `packages/code-reviewer/src/agent/create-agent.ts:16`. */
const DEFAULT_STEP_BUDGET = 20;

/**
 * Wall-clock ceiling for one cell.
 *
 * A hung cell must fail as a cell rather than wedge the sweep. The production failure this guards
 * against is on record: calibration run 5 hit the *job* timeout and left the PR green, because a
 * cancelled job is not a failed one (`context/archive/2026-09-07-ci-cd-code-review/calibration.md`).
 * Twelve minutes is roughly twice the slowest completed calibration run.
 */
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Per-step output ceiling.
 *
 * A complete review is a few thousand tokens. This is not a quality lever, it is a blast radius:
 * the failure mode cheap models actually exhibit here is a single request that never stops
 * generating, and an uncapped one costs the cell's entire wall-clock budget before anything says
 * why. Measured on the first sweep — `deepseek/deepseek-v4-flash` emitted **88,045 output tokens**
 * against a 6,785-token prompt in one request, twelve minutes at 122 tok/s, and produced no
 * review. This repository has the same shape on record for a different model: calibration run 3
 * burned 160k output tokens over 9m41s and returned no object.
 *
 * With the cap, that run instead ends in ~2 minutes with `finishReason: "length"` — which is a
 * diagnosis rather than a timeout. Generous enough not to truncate a legitimate review, including
 * one from a model that spends output tokens on reasoning.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;

/**
 * Renders one tool call compactly for the progress line — `read_file src/x.tsx`, not a JSON dump.
 *
 * The argument names are the three review tools' own (`path` for `read_file`/`list_files`, `query`
 * for `search_code`); anything else degrades to the bare tool name rather than guessing.
 */
function describeToolCall(call: AgentToolCall): string {
  const input = call.input;
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    const detail = [record.path, record.query].find((value) => typeof value === "string" && value !== "");
    if (typeof detail === "string") return `${call.toolName}(${detail})`;
  }
  return call.toolName;
}

/**
 * Streams one line per step to stderr while a cell runs.
 *
 * A 20-step agent loop over a real diff takes minutes, and promptfoo's progress bar says only that
 * a cell is in flight. Without this a slow model and a wedged one look identical — which is exactly
 * how the first run of this harness spent twelve minutes before its own timeout fired, with nothing
 * to say whether it had been reading files or spinning. stderr, not stdout, so it never lands in
 * the report.
 */
function logStep(label: string, index: number, step: AgentStep): void {
  const tools = step.toolCalls.map(describeToolCall).join(", ") || "(no tool calls)";
  const outputTokens = step.usage.outputTokens ?? 0;
  process.stderr.write(
    `  [${label}] step ${String(index)}: ${step.finishReason} — ${tools} (${String(outputTokens)} out)\n`,
  );
}

/** USD per million tokens, as OpenRouter lists them. See `pricing` below. */
interface Pricing {
  prompt: number;
  completion: number;
}

export interface CodeReviewerProviderConfig {
  /** An OpenRouter model id, `vendor/model`. The only variable across the matrix. */
  model?: string;
  /**
   * Whether the request demands strict `json_schema` enforcement. Exposed per provider because
   * strict enforcement at the END of a 20-step tool loop is the specific thing cheaper models have
   * failed here (calibration runs 3 and 4), and `model.ts:20-32` documents relaxing it as the
   * intended lever. Relaxing it does not relax the result — the object is still validated against
   * `reviewSchema` inside the package.
   */
  structuredOutputs?: { strict: boolean };
  /**
   * Sampling temperature. Left unset across this matrix and kept here for a future single-model
   * sweep: `anthropic/claude-sonnet-5` declares no `temperature` support on any of its OpenRouter
   * endpoints, and sending it alongside `require_parameters: true` empties the eligible endpoint
   * set and fails the request outright (`scripts/pr-review.mjs:41-56`). Uniformity across the
   * matrix is achieved by omission.
   */
  temperature?: number;
  stepBudget?: number;
  timeoutMs?: number;
  /** Per-step output ceiling. See `DEFAULT_MAX_OUTPUT_TOKENS` — it is a blast radius, not a knob. */
  maxOutputTokens?: number;
  /**
   * USD per million tokens, from https://openrouter.ai/models, pinned in the config.
   *
   * OpenRouter reports a real per-request cost only when the request opts into usage accounting,
   * and `createModel` exposes no lever for that (`packages/code-reviewer/src/model.ts:41` forwards
   * `provider` and `structuredOutputs`, nothing else) — and this change does not modify the package.
   * So the cost column is computed from the run's own token counts against prices declared here.
   * That makes a sweep's cost reproducible and reviewable rather than dependent on a provider flag,
   * at the price of going stale when OpenRouter re-prices; `metadata.costBasis` says so in every
   * cell. Omit it and the cell reports no cost rather than a wrong one.
   */
  pricing?: Pricing;
}

/** Why a cell produced no review. Mirrors `ReviewErrorCode` plus this provider's own timeout. */
type ErrorCode = "no-output-generated" | "step-budget-exhausted" | "timeout" | "run-failed";

interface CellMetadata extends Record<string, unknown> {
  model: string;
  steps?: number;
  toolCalls?: number;
  toolNames?: string[];
  finishReason?: string;
  errorCode?: ErrorCode;
  costBasis?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads a required string out of promptfoo's loosely-typed `vars`. */
function requireStringVar(vars: Record<string, unknown>, name: string): string {
  const value = vars[name];
  if (typeof value !== "string" || value === "") {
    throw new Error(`The test case is missing a \`${name}\` var. It is set by evals/cases.ts.`);
  }
  return value;
}

/** `usage` is optional at every level; a missing count is reported as absent, never as zero. */
function toTokenUsage(usage: RunUsage): { prompt?: number; completion?: number; total?: number; cached?: number } {
  return {
    ...(usage.inputTokens === undefined ? {} : { prompt: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { completion: usage.outputTokens }),
    ...(usage.totalTokens === undefined ? {} : { total: usage.totalTokens }),
    ...(usage.inputTokenDetails?.cacheReadTokens === undefined
      ? {}
      : { cached: usage.inputTokenDetails.cacheReadTokens }),
  };
}

function computeCost(usage: RunUsage, pricing: Pricing | undefined): number | undefined {
  if (pricing === undefined) return undefined;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  return (inputTokens * pricing.prompt + outputTokens * pricing.completion) / 1_000_000;
}

/**
 * The AI SDK's "no object" errors, recognised by name.
 *
 * `review-code.ts` uses `NoObjectGeneratedError.isInstance`, but the `ai` package is a dependency
 * of `packages/code-reviewer`, not of this repository's root — so the class itself is out of reach
 * here and the stable `name` is what remains. See the header of `evals/reviewer.ts`.
 */
function isNoObjectError(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === "AI_NoObjectGeneratedError" || error.name === "AI_NoOutputGeneratedError")
  );
}

export default class CodeReviewerProvider implements ApiProvider {
  readonly config: CodeReviewerProviderConfig;
  readonly label: string | undefined;
  private readonly providerId: string;
  private readonly model: string;

  constructor(options: ProviderOptions = {}) {
    const config = (isRecord(options.config) ? options.config : {}) as CodeReviewerProviderConfig;
    if (typeof config.model !== "string" || config.model === "") {
      throw new Error(
        "This provider needs `config.model` set to an OpenRouter model id, e.g. `anthropic/claude-sonnet-5`.",
      );
    }

    this.config = config;
    this.model = config.model;
    this.label = options.label;
    // Distinct per model, so three entries pointing at this one file stay three columns — and so
    // none of them can collide with the grading provider's id, which promptfoo answers with a
    // stack overflow rather than an error message (promptfoo issue #10501).
    this.providerId = `code-reviewer:${config.model}`;
  }

  id(): string {
    return this.providerId;
  }

  async callApi(_prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    const vars: Record<string, unknown> = context?.vars ?? {};
    const caseId = requireStringVar(vars, "caseId");
    const { answerKey, rootDir, diff } = loadCase(caseId);

    const reviewer = await loadReviewer();

    /*
     * Env order is load-bearing. `loadConfig(env)` reads the `.env` file ONLY when handed
     * `process.env` itself (`packages/code-reviewer/src/config.ts:36`), and this provider must
     * hand it a *different* `OPENROUTER_MODEL` per instance. So: bare call first, which
     * side-effects `.env` into `process.env` and validates the key; only then the per-model
     * override. Reversed, this reports "OPENROUTER_API_KEY is required" against a `.env` sitting
     * right there.
     */
    reviewer.loadConfig();
    const config = reviewer.loadConfig({ ...process.env, OPENROUTER_MODEL: this.model });

    const model = reviewer.createModel(config, {
      // Not a nicety: OpenRouter serves one model id from several endpoints that do not all
      // support `structured_outputs`, and routing a `response_format` request to one that does not
      // is how calibration run 3 burned 160k tokens and returned nothing. See `pr-review.mjs:107`.
      provider: { require_parameters: true },
      ...(this.config.structuredOutputs === undefined ? {} : { structuredOutputs: this.config.structuredOutputs }),
    });

    const stepBudget = this.config.stepBudget ?? DEFAULT_STEP_BUDGET;
    const agent = reviewer.createReviewAgent({
      model,
      rootDir,
      extraInstructions: REVIEW_RUBRIC,
      stepBudget,
      maxOutputTokens: this.config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      ...(this.config.temperature === undefined ? {} : { temperature: this.config.temperature }),
    });

    // `prDescription`, NEVER `description`. The latter is the case's own documentation and names
    // the planted flaws and decoys; sending it hands the reviewer the answer key, and the result
    // looks better rather than failing. See the field's comment in `evals/case.ts`.
    const prompt = reviewer.buildReviewPrompt({
      paths: answerKey.paths,
      title: answerKey.title,
      description: answerKey.prDescription,
      diff,
    });

    const timeout = AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const baseMetadata: CellMetadata = { model: this.model };

    const label = this.label ?? this.model;
    let stepIndex = 0;

    let result;
    try {
      result = await agent.generate({
        prompt,
        abortSignal: timeout,
        onStepFinish: (step) => {
          stepIndex += 1;
          logStep(label, stepIndex, step);
        },
      });
    } catch (error: unknown) {
      // A cancelled cell and a cell that answered nothing are different states, and only one of
      // them is about the model.
      const code: ErrorCode = timeout.aborted
        ? "timeout"
        : isNoObjectError(error)
          ? "no-output-generated"
          : "run-failed";
      return {
        // `steps` is how far the loop actually got — the difference between a model that was
        // reading files when the clock ran out and one that never made a call at all.
        error: `${code} after ${String(stepIndex)} step(s): ${error instanceof Error ? error.message : String(error)}`,
        metadata: { ...baseMetadata, errorCode: code, steps: stepIndex },
      };
    }

    const runMetadata: CellMetadata = {
      ...baseMetadata,
      steps: result.steps.length,
      toolCalls: result.toolCalls.length,
      toolNames: [...new Set(result.toolCalls.map((call) => call.toolName))],
      finishReason: result.finishReason,
    };

    let review: Review;
    try {
      // `.output` is a throwing getter, not an optional field.
      review = result.output;
    } catch (error: unknown) {
      if (!isNoObjectError(error)) throw error;

      /*
       * `review-code.ts:92-107`'s two-arm diagnosis, reproduced. A run that still wanted to call
       * tools when the loop stopped ran out of budget — and so did one that used every step it
       * had. The second arm is the one that fires by default, because the agent's own net takes
       * the tools away on the last step, so `finishReason` is never "tool-calls" there.
       */
      const exhausted = result.finishReason === "tool-calls" || result.steps.length >= stepBudget;
      const code: ErrorCode = exhausted ? "step-budget-exhausted" : "no-output-generated";
      return {
        error:
          code === "step-budget-exhausted"
            ? `step-budget-exhausted: the review used all ${String(result.steps.length)} of its steps without producing a verdict.`
            : "no-output-generated: the review finished without producing a verdict.",
        metadata: { ...runMetadata, errorCode: code },
        tokenUsage: toTokenUsage(result.usage),
      };
    }

    const cost = computeCost(result.usage, this.config.pricing);

    return {
      // An object, not a string: this is what lets the `javascript` assertions receive an
      // already-parsed `Review` instead of re-parsing the model's JSON.
      output: review,
      tokenUsage: toTokenUsage(result.usage),
      ...(cost === undefined ? {} : { cost }),
      metadata: {
        ...runMetadata,
        ...(cost === undefined ? {} : { costBasis: "computed from config.pricing × run token usage" }),
      },
    };
  }
}
