import { readFile, stat } from "node:fs/promises";
import { tool } from "ai";
import { z } from "zod";
import { nodeErrorCode } from "./fs-errors.ts";
import type { ResolveWithinRoot } from "./paths.ts";

/** Above this, a single read would dominate the context window; page instead. */
const MAX_FILE_BYTES = 2_000_000;
/** Ceiling on lines returned by one call, whatever range was asked for. */
const MAX_LINES = 1_500;

export const readFileInputSchema = z.object({
  path: z.string().min(1).describe("File to read, relative to the review root."),
  startLine: z.number().int().positive().optional().describe("1-indexed first line to return. Defaults to the top."),
  endLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-indexed last line to return, inclusive. Defaults to the end of the file."),
});

/**
 * Prefixes each line with its 1-indexed number so findings can cite exact lines
 * without the model having to count.
 */
function numberLines(lines: string[], firstLine: number): string {
  return lines.map((line, index) => `${firstLine + index}| ${line}`).join("\n");
}

export function createReadFileTool(resolveWithinRoot: ResolveWithinRoot) {
  return tool({
    description: [
      "Read a file from the codebase under review.",
      "Paths are relative to the review root; anything resolving outside it is refused.",
      "Use this for every file named in the review request, and for any other file you need to check a caller, a type, or a contract before claiming a defect.",
      'Lines come back prefixed with their 1-indexed number ("12| const x = 1") so you can cite them exactly — never copy the prefix into a finding or a suggestion.',
      "Long files are truncated; pass startLine and endLine to page through the rest.",
    ].join(" "),
    inputSchema: readFileInputSchema,
    execute: async ({ path, startLine, endLine }) => {
      const resolved = resolveWithinRoot(path);
      if (!resolved.ok) return { ok: false as const, error: resolved.message };

      try {
        const stats = await stat(resolved.absolutePath);
        if (stats.isDirectory()) {
          return { ok: false as const, error: `"${path}" is a directory. Use list_files to see what is in it.` };
        }
        if (stats.size > MAX_FILE_BYTES) {
          return { ok: false as const, error: `"${path}" is ${stats.size} bytes, too large to read in one call.` };
        }
      } catch (error: unknown) {
        const code = nodeErrorCode(error);
        if (code === "ENOENT" || code === "ENOTDIR") {
          return { ok: false as const, error: `"${path}" does not exist in the review root.` };
        }
        throw error;
      }

      const allLines = (await readFile(resolved.absolutePath, "utf8")).split(/\r?\n/);
      const from = Math.min(startLine ?? 1, allLines.length);
      const to = Math.min(endLine ?? allLines.length, allLines.length, from + MAX_LINES - 1);
      const slice = allLines.slice(from - 1, to);

      return {
        ok: true as const,
        path: resolved.relativePath,
        startLine: from,
        endLine: to,
        totalLines: allLines.length,
        truncated: to < allLines.length,
        content: numberLines(slice, from),
      };
    },
  });
}
