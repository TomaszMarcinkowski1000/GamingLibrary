export interface ReviewPromptInput {
  /** Root-relative paths under review. The agent reads them through its tools. */
  paths: readonly string[];
  /** Extra context: the change's intent, the surrounding conventions, a checklist. */
  context?: string;
  /** One-line title of the change, as its author stated it. */
  title?: string;
  /** The author's own description of the change. */
  description?: string;
  /**
   * Unified diff of the change. The agent has no git tool and its file tools
   * read the checkout's current state, so the delta only reaches it as text.
   */
  diff?: string;
}

/**
 * Composes the user-facing half of a review request. It names the files rather
 * than carrying their contents — fetching them is the agent's job. A pure
 * function of its input, so the prompt shape can be asserted on without a model
 * in the loop.
 *
 * The diff goes last because it is the one section that can run to thousands of
 * lines; keeping it after the instructions stops it pushing them out of the
 * model's attention.
 */
export function buildReviewPrompt({ paths, context, title, description, diff }: ReviewPromptInput): string {
  const fileList =
    paths.length > 0
      ? paths.map((path) => `- ${path}`).join("\n")
      : "- (none named — use list_files to find what is worth reviewing)";

  return [
    title ? `Title:\n${title}` : undefined,
    description ? `Description:\n${description}` : undefined,
    `Review these files, as paths relative to the review root:\n${fileList}`,
    context ? `Context:\n${context}` : undefined,
    diff ? `Diff under review:\n${diff}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}
