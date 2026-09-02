import { createListFilesTool } from "./list-files.ts";
import { createPathGuard } from "./paths.ts";
import { createReadFileTool } from "./read-file.ts";
import { createSearchCodeTool } from "./search-code.ts";

export { createPathGuard } from "./paths.ts";
export type { PathAllowed, PathGuard, PathRefused, PathResolution, ResolveWithinRoot } from "./paths.ts";
export { createReadFileTool, readFileInputSchema } from "./read-file.ts";
export { createListFilesTool, listFilesInputSchema } from "./list-files.ts";
export { createSearchCodeTool, searchCodeInputSchema } from "./search-code.ts";
export type { SearchMatch } from "./search-code.ts";

export interface CreateReviewToolsOptions {
  /** The only directory the agent may read from. Every tool path resolves against it. */
  rootDir: string;
}

/**
 * Builds the agent's read-only tool set. Every tool needs the same root closure,
 * so the root is resolved and the containment guard constructed once here rather
 * than once per tool.
 */
export function createReviewTools({ rootDir }: CreateReviewToolsOptions) {
  const { root, resolveWithinRoot } = createPathGuard(rootDir);

  return {
    read_file: createReadFileTool(resolveWithinRoot),
    list_files: createListFilesTool(resolveWithinRoot),
    search_code: createSearchCodeTool(resolveWithinRoot, root),
  };
}

export type ReviewTools = ReturnType<typeof createReviewTools>;
