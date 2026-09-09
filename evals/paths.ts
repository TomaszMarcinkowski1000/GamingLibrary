/*
 * Where this harness's inputs live, resolved once per process.
 *
 * `import.meta.url` is deliberately not the anchor. promptfoo loads every `file://` module —
 * providers, test generators, assertion scripts — through its own importer, so what
 * `import.meta.url` reports inside one of them is promptfoo's business rather than a stable fact
 * about this repository. Walking up from the working directory for the config file is anchored on
 * something that cannot move: `npm run evals` sets the cwd to the package root, and a hand-run
 * from a subdirectory still finds its way up.
 *
 * The lookup is lazy and memoised rather than a module-level constant: a throw at import time
 * surfaces as an opaque module-resolution failure inside promptfoo, whereas a throw at call time
 * carries the message below.
 */
import { existsSync } from "node:fs";
import path from "node:path";

/** The marker that identifies the repository root — this harness's own config file. */
const CONFIG_MARKER = path.join("evals", "promptfooconfig.yaml");

let cachedRoot: string | undefined;

/** Absolute path of the repository root. */
export function repoRoot(): string {
  if (cachedRoot !== undefined) return cachedRoot;

  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, CONFIG_MARKER))) {
      cachedRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find ${CONFIG_MARKER} at or above ${process.cwd()}. ` +
          `Run the harness with \`npm run evals\` from the repository root.`,
      );
    }
    dir = parent;
  }
}

/** Absolute path of one case directory, e.g. `evals/cases/react-19-migration`. */
export function caseDir(caseId: string): string {
  return path.join(repoRoot(), "evals", "cases", caseId);
}

/**
 * Absolute path of a file inside the built package under test.
 *
 * `packages/code-reviewer` is a standalone npm project whose `dist/` is gitignored, so this is a
 * runtime path rather than an import specifier — exactly as `scripts/pr-review.mjs:40` resolves it.
 */
export function reviewerDist(relativePath: string): string {
  return path.join(repoRoot(), "packages", "code-reviewer", "dist", relativePath);
}
