#!/usr/bin/env node
/*
 * Regenerate `case.diff` for every eval case from its own `before/` and `after/` trees.
 *
 * The diff the reviewer under test is handed must be *derived* from the fixture rather than
 * hand-written beside it: those two plus `case.json`'s line references are three artifacts that
 * only ever agree byte-for-byte, and when they drift nothing errors — the eval keeps running and
 * grades a model against stale line numbers. So the diff is generated here, committed, and this
 * script re-run as a gate: on an unchanged fixture it must leave the working tree clean.
 *
 * Two things it has to get right:
 *
 *   1. `git diff --no-index` exits 1 when the inputs differ, which is the normal case here. Only
 *      an exit code above 1 is a real failure.
 *   2. Paths are rewritten from `before/src/x` / `after/src/x` down to `src/x`. The agent's
 *      sandboxed `rootDir` *is* the `after/` tree, so a path in the diff has to be the same path
 *      its `read_file` tool takes — otherwise every finding cites a file the tools cannot open.
 *
 * Usage: `npm run evals:diff`
 */
import { spawnSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const casesDir = path.join(repoRoot, "evals", "cases");

/**
 * Strip the `before/` and `after/` tree prefixes from the diff's header lines only.
 *
 * `---`/`+++` are matched positionally (they follow a `diff --git` line) rather than by content,
 * so a fixture whose source genuinely contains a line beginning `--- before/` is left alone.
 */
function normalizePaths(diff) {
  const lines = diff.split("\n");
  let inHeader = false;

  return lines
    .map((line) => {
      if (line.startsWith("diff --git ")) {
        inHeader = true;
        // Both sides carry a tree prefix, but not always the *same* one: for an added or deleted
        // file git repeats the surviving side, so this line can read `before/x before/x` or
        // `after/x after/x` as well as `before/x after/x`. Strip each side independently.
        return `diff --git ${line
          .slice("diff --git ".length)
          .split(" ")
          .map((p) => p.replace(/^(?:before|after)\//, ""))
          .join(" ")}`;
      }
      if (!inHeader) return line;
      if (line.startsWith("--- before/")) return `--- ${line.slice("--- before/".length)}`;
      if (line.startsWith("+++ after/")) {
        inHeader = false;
        return `+++ ${line.slice("+++ after/".length)}`;
      }
      if (line.startsWith("@@")) inHeader = false;
      return line;
    })
    .join("\n");
}

function generate(caseDir) {
  const result = spawnSync("git", ["diff", "--no-index", "--no-prefix", "--", "before", "after"], {
    cwd: caseDir,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  // 0 = identical trees, 1 = they differ (the expected case). Anything else is git failing.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git diff exited ${String(result.status)} in ${caseDir}:\n${result.stderr}`);
  }

  const diff = normalizePaths(result.stdout.replace(/\r\n/g, "\n"));
  const target = path.join(caseDir, "case.diff");
  writeFileSync(target, diff, "utf8");
  return { target, bytes: Buffer.byteLength(diff) };
}

const caseDirs = readdirSync(casesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(casesDir, entry.name))
  .sort();

if (caseDirs.length === 0) {
  console.error(`No case directories under ${casesDir}`);
  process.exit(1);
}

for (const caseDir of caseDirs) {
  const { target, bytes } = generate(caseDir);
  console.log(`${path.relative(repoRoot, target)} — ${String(bytes)} bytes`);
}
