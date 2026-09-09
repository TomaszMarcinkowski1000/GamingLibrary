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
 *   1. `git diff --no-index` exits 1 when the inputs differ, which is the only healthy outcome
 *      here. Exit 0 (identical trees) is a broken fixture rather than a no-op: that empty diff
 *      would show the reviewer under test no change at all *and* replace the committed one. It
 *      and any code above 1 are both hard failures.
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

/**
 * Produce one case's normalized diff. Deliberately does not write it.
 *
 * Every case is generated before any case is written, because the corpus is graded as a set: a
 * throw partway through a writing loop would leave the earlier cases regenerated and the rest
 * stale, which is the same silent desync this script exists to prevent — only harder to spot,
 * since the working tree would then be dirty for reasons that look intentional.
 */
function generate(caseDir) {
  const result = spawnSync("git", ["diff", "--no-index", "--no-prefix", "--", "before", "after"], {
    cwd: caseDir,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  // 1 = the trees differ, the expected case. 0 = identical trees, which is never legitimate here.
  // Anything above 1 is git itself failing.
  if (result.status !== 1) {
    throw new Error(
      result.status === 0
        ? `before/ and after/ are identical in ${caseDir} — refusing to write an empty case.diff`
        : `git diff exited ${String(result.status)} in ${caseDir}:\n${result.stderr}`,
    );
  }

  const diff = normalizePaths(result.stdout.replace(/\r\n/g, "\n"));
  if (diff.trim() === "") {
    throw new Error(`git diff produced no output in ${caseDir} — refusing to write an empty case.diff`);
  }

  return { target: path.join(caseDir, "case.diff"), diff };
}

function main() {
  const caseDirs = readdirSync(casesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(casesDir, entry.name))
    .sort();

  if (caseDirs.length === 0) {
    console.error(`No case directories under ${casesDir}`);
    return 1;
  }

  let generated;
  try {
    generated = caseDirs.map((caseDir) => generate(caseDir));
  } catch (cause) {
    console.error(`FAIL  ${cause.message}`);
    console.error("Nothing was written — the corpus is unchanged.");
    return 1;
  }

  for (const { target, diff } of generated) {
    writeFileSync(target, diff, "utf8");
    console.log(`${path.relative(repoRoot, target)} — ${String(Buffer.byteLength(diff))} bytes`);
  }
  return 0;
}

process.exitCode = main();
