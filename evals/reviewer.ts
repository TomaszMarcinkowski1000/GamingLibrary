/*
 * The system under test, loaded the way `scripts/pr-review.mjs:40` loads it: by file URL, at
 * runtime, out of `packages/code-reviewer/dist`.
 *
 * Why not a static import. `packages/*` are standalone npm projects, not workspaces (see the
 * `ignores` in `eslint.config.js` and the `packages` job in `.github/workflows/ci.yml`): the root
 * `npm ci` never fetches their dependencies, their `dist/` is gitignored, and CI runs
 * `npm run typecheck` at the root without building them. A static import into `dist/` would
 * therefore fail `astro check` on every clean checkout — a gate that has nothing to do with evals.
 * A runtime URL import keeps the root program independent of whether the package happens to be
 * built, at the cost of the package's types not crossing the boundary.
 *
 * So the surface this harness uses is restated below. It is deliberately narrow — three functions,
 * one schema, one prompt builder — and `npm run evals` builds the package before promptfoo starts,
 * so drift shows up as a TypeError on the first cell rather than as a silently wrong result.
 *
 * `buildReviewPrompt` comes from a deep path because the barrel does not re-export it
 * (`packages/code-reviewer/src/index.ts`). Composing the prompt here rather than copying
 * `buildReviewPrompt`'s body is the point: the eval must send the shape production sends, and a
 * copy would drift from it without anything failing.
 */
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { reviewerDist } from "./paths.ts";

/** One scored criterion. Mirrors `packages/code-reviewer/src/schemas/criterion.ts`. */
export interface CriterionScore {
  id: string;
  score: number;
  rationale: string;
}

/** One reported defect. Mirrors `packages/code-reviewer/src/schemas/finding.ts`. */
export interface Finding {
  file: string;
  line: number;
  severity: "info" | "minor" | "major" | "critical";
  title: string;
  detail: string;
  suggestion?: string;
}

/** A validated review. Mirrors `packages/code-reviewer/src/schemas/review.ts`. */
export interface Review {
  summary: string;
  criteria: CriterionScore[];
  findings: Finding[];
}

/**
 * Validated environment, opaque to this harness apart from the model id — it is produced by
 * `loadConfig` and handed straight back to `createModel`.
 */
export interface ReviewerConfig {
  readonly OPENROUTER_MODEL: string;
}

/** An AI SDK `LanguageModel`, carried opaquely between `createModel` and `createReviewAgent`. */
export interface ReviewerModel {
  readonly modelId?: string;
}

/** The token counts an AI SDK v7 run reports. Every field is optional at the provider's whim. */
export interface RunUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
}

/** One tool call the model made. `input` is model-authored and arrives untyped. */
export interface AgentToolCall {
  readonly toolName: string;
  readonly input?: unknown;
}

/** One step of the loop, as `onStepFinish` receives it. */
export interface AgentStep {
  readonly finishReason: string;
  readonly toolCalls: readonly AgentToolCall[];
  readonly usage: RunUsage;
}

/**
 * What `agent.generate()` resolves to, narrowed to the fields this harness reads.
 *
 * `output` is a **throwing getter**, not an optional field: it raises rather than returning
 * undefined when the loop produced no schema-valid object. Reproducing that diagnosis is the
 * provider's job — see `review-code.ts:92-107`.
 */
export interface AgentRunResult {
  readonly finishReason: string;
  readonly steps: readonly unknown[];
  readonly toolCalls: readonly AgentToolCall[];
  readonly usage: RunUsage;
  readonly output: Review;
}

export interface ReviewAgent {
  generate(options: {
    prompt: string;
    abortSignal?: AbortSignal;
    onStepFinish?: (step: AgentStep) => void;
  }): Promise<AgentRunResult>;
}

export interface CreateReviewAgentOptions {
  model: ReviewerModel;
  rootDir: string;
  extraInstructions?: string;
  stepBudget?: number;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface CreateModelOptions {
  /** OpenRouter routing preferences. `require_parameters` is load-bearing — see `pr-review.mjs:107`. */
  provider?: { require_parameters?: boolean };
  /** Whether the request demands strict `json_schema` enforcement. See `model.ts:20-32`. */
  structuredOutputs?: { strict: boolean };
}

export interface SafeParseFailure {
  success: false;
  error: { issues: { path: readonly (string | number | symbol)[]; message: string }[] };
}

export type SafeParseResult = { success: true; data: Review } | SafeParseFailure;

/** The package barrel's exports, narrowed to what this harness calls. */
interface ReviewerBarrel {
  loadConfig: (env?: NodeJS.ProcessEnv) => ReviewerConfig;
  createModel: (config: ReviewerConfig, options?: CreateModelOptions) => ReviewerModel;
  createReviewAgent: (options: CreateReviewAgentOptions) => ReviewAgent;
  reviewSchema: { safeParse: (value: unknown) => SafeParseResult };
}

interface PromptsBarrel {
  buildReviewPrompt: (input: {
    paths: readonly string[];
    title?: string;
    description?: string;
    diff?: string;
    context?: string;
  }) => string;
}

export type Reviewer = ReviewerBarrel & PromptsBarrel;

const NOT_BUILT =
  "packages/code-reviewer is not built. Run `npm run evals`, which builds it first, " +
  "or `npm ci && npm run build` inside packages/code-reviewer.";

let cached: Promise<Reviewer> | undefined;

async function importReviewer(): Promise<Reviewer> {
  const entry = reviewerDist("index.js");
  const prompts = reviewerDist("prompts/index.js");
  if (!existsSync(entry) || !existsSync(prompts)) throw new Error(NOT_BUILT);

  // Non-literal specifiers on purpose: the target is a build artifact, so it must not participate
  // in this program's module resolution. The casts are the boundary the file header describes.
  const barrel = (await import(pathToFileURL(entry).href)) as ReviewerBarrel;
  const promptsBarrel = (await import(pathToFileURL(prompts).href)) as PromptsBarrel;

  return { ...barrel, ...promptsBarrel };
}

/** Loads the package under test once per process. */
export function loadReviewer(): Promise<Reviewer> {
  cached ??= importReviewer();
  return cached;
}
