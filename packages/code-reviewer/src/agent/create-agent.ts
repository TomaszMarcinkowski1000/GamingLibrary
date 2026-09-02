import { Output, ToolLoopAgent, isStepCount } from "ai";
import type { LanguageModel, StopCondition } from "ai";
import { REVIEW_INSTRUCTIONS } from "../prompts/index.ts";
import { reviewSchema } from "../schemas/index.ts";
import { createReviewTools } from "../tools/index.ts";
import type { ReviewTools } from "../tools/index.ts";

/**
 * Steps one review may take, matching the AI SDK's own default. Generating the
 * structured output is itself a step, so this is roughly nineteen tool calls
 * plus the final verdict.
 *
 * Ten proved too tight against a real file: one review drew nine tool calls, so
 * the budget — not the evidence — was deciding when the verdict came.
 */
export const DEFAULT_STEP_BUDGET = 20;

/** Stop conditions accepted by the review agent, typed against its tool set. */
export type ReviewStopCondition = StopCondition<ReviewTools> | StopCondition<ReviewTools>[];

/**
 * How many steps a run may actually take, or `undefined` when that is unknown.
 * A caller who overrides `stopWhen` without saying how many steps that allows
 * leaves the loop's end unknowable, and both the safety net and the
 * budget-exhausted diagnosis depend on knowing it — so they resolve it here,
 * once, rather than each reaching their own conclusion.
 */
export function resolveStepBudget(
  stepBudget: number | undefined,
  stopWhen: ReviewStopCondition | undefined,
): number | undefined {
  return stepBudget ?? (stopWhen === undefined ? DEFAULT_STEP_BUDGET : undefined);
}

export interface CreateReviewAgentOptions {
  /**
   * Any AI SDK language model. Required rather than derived from `loadConfig()`,
   * which is what lets an eval harness drive this package with a mock model and
   * no OpenRouter credential.
   */
  model: LanguageModel;
  /** The only directory the agent's tools may read from. */
  rootDir: string;
  /** Appended to the standing instructions — a project checklist, say. */
  extraInstructions?: string;
  /** Overrides the default stop condition. */
  stopWhen?: ReviewStopCondition;
  /**
   * How many steps the loop may take. Drives the default `stopWhen` and tells
   * the final-step net where the end is. Pass it alongside a custom `stopWhen`
   * to keep the net; omit both and the default budget applies.
   */
  stepBudget?: number;
  /** Sampling temperature; pin it low for reproducible eval runs. */
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Builds the review agent. The single place agent configuration lives, so a
 * future eval provider can construct one per case with an injected model.
 *
 * Instructions go in `instructions`, never in the prompt: `allowSystemInMessages`
 * defaults to `false`, so a system message routed through `prompt` is rejected.
 */
export function createReviewAgent({
  model,
  rootDir,
  extraInstructions,
  stopWhen,
  stepBudget,
  temperature,
  maxOutputTokens,
}: CreateReviewAgentOptions) {
  // The net needs to know where the loop actually ends; without that it gets no
  // net rather than one that fires at the wrong step.
  const budget = resolveStepBudget(stepBudget, stopWhen);

  return new ToolLoopAgent({
    model,
    instructions: extraInstructions ? `${REVIEW_INSTRUCTIONS}\n\n${extraInstructions}` : REVIEW_INSTRUCTIONS,
    tools: createReviewTools({ rootDir }),
    output: Output.object({ schema: reviewSchema }),
    stopWhen: stopWhen ?? isStepCount(budget ?? DEFAULT_STEP_BUDGET),
    // Take the tools away on the last affordable step so the model has to answer.
    // Without this a model that keeps reading returns nothing at all rather than
    // a verdict drawn from what it has already seen.
    ...(budget === undefined
      ? {}
      : {
          prepareStep: ({ stepNumber }: { stepNumber: number }) =>
            stepNumber >= budget - 1 ? { toolChoice: "none" as const } : {},
        }),
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  });
}

export type ReviewAgent = ReturnType<typeof createReviewAgent>;
