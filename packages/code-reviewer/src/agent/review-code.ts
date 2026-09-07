import { NoObjectGeneratedError, NoOutputGeneratedError } from "ai";
import type { LanguageModel } from "ai";
import { ReviewError } from "../errors.ts";
import { buildReviewPrompt } from "../prompts/index.ts";
import type { Review } from "../schemas/index.ts";
import { createReviewAgent, resolveStepBudget } from "./create-agent.ts";
import type { ReviewStopCondition } from "./create-agent.ts";

export interface ReviewOptions {
  model: LanguageModel;
  /** The only directory the agent may read from. Every path resolves against it. */
  rootDir: string;
  /** Root-relative files under review. The agent reads them through its own tools. */
  paths: readonly string[];
  /** Extra context: the change's intent, the surrounding conventions, a checklist. */
  context?: string;
  /** One-line title of the change under review. */
  title?: string;
  /** The author's own description of the change. */
  description?: string;
  /** Unified diff of the change; the agent has no git tool, so the delta only reaches it here. */
  diff?: string;
  /** Appended to the standing instructions — a project checklist, say. See `createReviewAgent`. */
  extraInstructions?: string;
  /** Overrides the default stop condition for this run. */
  stopWhen?: ReviewStopCondition;
  /** How many steps this run may take. See `createReviewAgent`. */
  stepBudget?: number;
}

/**
 * Runs one review and returns schema-validated findings. The convenience
 * wrapper most callers want; reach for `createReviewAgent` directly when you
 * need the agent itself (streaming, lifecycle callbacks, repeated runs).
 *
 * Only run-level failures become `ReviewError`. A tool that refused a path is
 * not one of them — the SDK hands that back to the model as a `tool-error` part
 * and the loop carries on.
 */
export async function reviewCode({
  model,
  rootDir,
  paths,
  context,
  title,
  description,
  diff,
  extraInstructions,
  stopWhen,
  stepBudget,
}: ReviewOptions): Promise<Review> {
  const agent = createReviewAgent({
    model,
    rootDir,
    ...(extraInstructions === undefined ? {} : { extraInstructions }),
    ...(stopWhen === undefined ? {} : { stopWhen }),
    ...(stepBudget === undefined ? {} : { stepBudget }),
  });

  const budget = resolveStepBudget(stepBudget, stopWhen);
  const prompt = buildReviewPrompt({
    paths,
    ...(context === undefined ? {} : { context }),
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(diff === undefined ? {} : { diff }),
  });

  let result;
  try {
    result = await agent.generate({ prompt });
  } catch (error: unknown) {
    if (NoObjectGeneratedError.isInstance(error)) {
      throw new ReviewError("no-output-generated", "The model did not return a review matching the schema.", {
        cause: error,
      });
    }
    throw error;
  }

  try {
    return result.output;
  } catch (error: unknown) {
    if (!NoOutputGeneratedError.isInstance(error) && !NoObjectGeneratedError.isInstance(error)) throw error;

    // A run that still wanted to call tools when the loop stopped ran out of
    // budget — and so did one that used every step it had. The second arm is the
    // one that fires by default: the agent's own net takes the tools away on the
    // last step, so `finishReason` is never "tool-calls" there.
    if (result.finishReason === "tool-calls" || (budget !== undefined && result.steps.length >= budget)) {
      throw new ReviewError(
        "step-budget-exhausted",
        `The review used all ${String(result.steps.length)} of its steps without producing a verdict. Raise stopWhen or narrow the paths under review.`,
        { cause: error },
      );
    }

    throw new ReviewError("no-output-generated", "The review finished without producing a verdict.", { cause: error });
  }
}
