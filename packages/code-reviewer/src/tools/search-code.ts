import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { nodeErrorCode } from "./fs-errors.ts";
import type { ResolveWithinRoot } from "./paths.ts";

const MAX_MATCHES = 50;
const MAX_FILES_WALKED = 2_000;
/** Files above this are almost certainly generated or binary; not worth scanning. */
const MAX_FILE_BYTES = 1_000_000;
const MAX_LINE_LENGTH = 200;
/** A NUL byte never appears in source text — the cheapest binary check there is. */
const NUL = "\u0000";

/**
 * Skipped while walking purely to keep traversal affordable. This is a cost
 * measure, not a security boundary — containment is the root check in
 * `paths.ts` and nothing else.
 */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

export const searchCodeInputSchema = z.object({
  query: z.string().min(1).describe("Literal text to look for. Not a regular expression — matched as a substring."),
  path: z
    .string()
    .optional()
    .describe("Subtree to search, relative to the review root. Omit to search the whole root."),
  caseSensitive: z.boolean().optional().describe("Match case exactly. Defaults to false."),
});

/** One hit: a root-relative path, the 1-indexed line, and the trimmed line text. */
export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export function createSearchCodeTool(resolveWithinRoot: ResolveWithinRoot) {
  return tool({
    description: [
      "Search the codebase under review for a literal string, returning path, line number, and the matching line.",
      "Paths are relative to the review root; anything resolving outside it is refused.",
      "Use this to find callers of a function, other implementations of an interface, or every place a constant is used — the evidence that turns a suspicion into a finding.",
      "Reach for it only when a finding actually depends on code outside the files under review; results and traversal are both capped, and node_modules, .git, and dist are skipped.",
    ].join(" "),
    inputSchema: searchCodeInputSchema,
    execute: async ({ query, path, caseSensitive }) => {
      const requested = path ?? ".";
      const resolved = resolveWithinRoot(requested);
      if (!resolved.ok) return { ok: false as const, error: resolved.message };

      const needle = caseSensitive === true ? query : query.toLowerCase();
      const matches: SearchMatch[] = [];
      const stack: string[] = [resolved.absolutePath];
      let filesWalked = 0;
      let truncated = false;

      while (stack.length > 0 && !truncated) {
        const dir = stack.pop();
        if (dir === undefined) break;

        let dirents;
        try {
          dirents = await readdir(dir, { withFileTypes: true });
        } catch (error: unknown) {
          const code = nodeErrorCode(error);
          // A subtree that vanished or is unreadable mid-walk is not worth
          // failing the whole search over; anything else is a real bug.
          if (code === "ENOENT" || code === "EACCES" || code === "EPERM") continue;
          if (code === "ENOTDIR") {
            return { ok: false as const, error: `"${requested}" is a file, not a directory. Use read_file on it.` };
          }
          throw error;
        }

        for (const dirent of dirents) {
          if (truncated) break;
          const entryPath = join(dir, dirent.name);

          // `isDirectory()` is false for a symlink, so a symlinked directory is
          // never descended into — no cycles, and no walking out of the root.
          if (dirent.isDirectory()) {
            if (!SKIP_DIRS.has(dirent.name)) stack.push(entryPath);
            continue;
          }
          if (!dirent.isFile()) continue;

          if (filesWalked >= MAX_FILES_WALKED) {
            truncated = true;
            break;
          }
          filesWalked += 1;

          let contents: string;
          try {
            contents = await readFile(entryPath, "utf8");
          } catch {
            continue;
          }
          if (contents.length > MAX_FILE_BYTES || contents.includes(NUL)) continue;

          const lines = contents.split(/\r?\n/);
          for (const [index, line] of lines.entries()) {
            const haystack = caseSensitive === true ? line : line.toLowerCase();
            if (!haystack.includes(needle)) continue;

            matches.push({
              path: relative(resolved.absolutePath, entryPath).split(sep).join("/"),
              line: index + 1,
              text: line.trim().slice(0, MAX_LINE_LENGTH),
            });
            if (matches.length >= MAX_MATCHES) {
              truncated = true;
              break;
            }
          }
        }
      }

      return { ok: true as const, query, searchedPath: resolved.relativePath, filesWalked, truncated, matches };
    },
  });
}
