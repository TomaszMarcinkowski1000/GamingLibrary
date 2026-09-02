import { Output, generateText } from "ai";
import type { LanguageModel } from "ai";
import { REVIEW_INSTRUCTIONS, buildReviewPrompt } from "./prompts/index.ts";
import { reviewSchema } from "./schemas/index.ts";
import type { Review } from "./schemas/index.ts";

export { createModel } from "./model.ts";
export { findingSchema, reviewSchema, severities } from "./schemas/index.ts";
export type { Finding, Review } from "./schemas/index.ts";

export interface ReviewOptions {
  model: LanguageModel;
  /** The code to review. Include file paths so findings can cite them. */
  code: string;
  /** Extra context: the diff's intent, the surrounding conventions, a checklist. */
  context?: string;
}

/**
 * Runs one structured review pass and returns schema-validated findings.
 * The single entry point every future integration (CLI, CI job, PR bot)
 * should build on.
 */
export async function reviewCode({ model, code, context }: ReviewOptions): Promise<Review> {
  const { output } = await generateText({
    model,
    system: REVIEW_INSTRUCTIONS,
    output: Output.object({ schema: reviewSchema }),
    prompt: buildReviewPrompt({ code, ...(context ? { context } : {}) }),
  });

  return output;
}
