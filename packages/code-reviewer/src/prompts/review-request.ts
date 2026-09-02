export interface ReviewPromptInput {
  /** Root-relative paths under review. The agent reads them through its tools. */
  paths: readonly string[];
  /** Extra context: the change's intent, the surrounding conventions, a checklist. */
  context?: string;
}

/**
 * Composes the user-facing half of a review request. It names the files rather
 * than carrying their contents — fetching them is the agent's job. A pure
 * function of its input, so the prompt shape can be asserted on without a model
 * in the loop.
 */
export function buildReviewPrompt({ paths, context }: ReviewPromptInput): string {
  const fileList =
    paths.length > 0
      ? paths.map((path) => `- ${path}`).join("\n")
      : "- (none named — use list_files to find what is worth reviewing)";

  return [
    `Review these files, as paths relative to the review root:\n${fileList}`,
    context ? `Context:\n${context}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}
