import { readdir } from "node:fs/promises";
import { tool } from "ai";
import { z } from "zod";
import { nodeErrorCode } from "./fs-errors.ts";
import type { ResolveWithinRoot } from "./paths.ts";

/** One listing cannot flood the context window, however large the directory. */
const MAX_ENTRIES = 200;

export const listFilesInputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe('Directory to list, relative to the review root. Omit or pass "." for the root itself.'),
});

type EntryKind = "file" | "directory" | "other";

export function createListFilesTool(resolveWithinRoot: ResolveWithinRoot) {
  return tool({
    description: [
      "List the entries of a directory in the codebase under review.",
      "Paths are relative to the review root; anything resolving outside it is refused.",
      "Use this to orient yourself in an unfamiliar tree — to find where a module's siblings, tests, or types live — before deciding which files to read.",
      "Listings are capped, so prefer a specific subdirectory over the root when you already know roughly where to look.",
    ].join(" "),
    inputSchema: listFilesInputSchema,
    execute: async ({ path }) => {
      const requested = path ?? ".";
      const resolved = resolveWithinRoot(requested);
      if (!resolved.ok) return { ok: false as const, error: resolved.message };

      let dirents;
      try {
        dirents = await readdir(resolved.absolutePath, { withFileTypes: true });
      } catch (error: unknown) {
        const code = nodeErrorCode(error);
        if (code === "ENOENT")
          return { ok: false as const, error: `"${requested}" does not exist in the review root.` };
        if (code === "ENOTDIR") {
          return { ok: false as const, error: `"${requested}" is a file, not a directory. Use read_file on it.` };
        }
        throw error;
      }

      const entries = dirents
        .map((dirent) => {
          const kind: EntryKind = dirent.isDirectory() ? "directory" : dirent.isFile() ? "file" : "other";
          return { name: dirent.name, kind };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        ok: true as const,
        path: resolved.relativePath,
        totalEntries: entries.length,
        truncated: entries.length > MAX_ENTRIES,
        entries: entries.slice(0, MAX_ENTRIES),
      };
    },
  });
}
