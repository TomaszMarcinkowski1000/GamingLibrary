export interface ReviewPromptInput {
  /** The code to review. Include file paths so findings can cite them. */
  code: string;
  /** Extra context: the diff's intent, the surrounding conventions, a checklist. */
  context?: string;
}

/**
 * Composes the user-facing half of a review request. A pure function of its
 * input, so the prompt shape can be asserted on without a model in the loop.
 */
export function buildReviewPrompt({ code, context }: ReviewPromptInput): string {
  return [context ? `Context:\n${context}` : undefined, `Code under review:\n${code}`].filter(Boolean).join("\n\n");
}
