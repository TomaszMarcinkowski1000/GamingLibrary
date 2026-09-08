#!/usr/bin/env node
/*
 * Structural gate over every eval case's answer key.
 *
 * `case.json` is the artifact that outlives the runner: the flaw and decoy prose is what an
 * LLM judge grades a review against, and every `line` in it is a claim about a specific line of
 * the `after/` tree. Those claims go stale silently — reformat a fixture, add an import, and the
 * key still parses while pointing at the wrong code. This script re-checks them mechanically.
 *
 * It verifies, per case: the JSON parses; `rootDir` and `diffPath` exist; every `paths[]` entry
 * resolves under `rootDir`; every flaw/decoy `file` resolves under `rootDir` and its `line` is in
 * range; ids are unique; and every flaw carries a severity the review schema uses.
 *
 * Usage: `npm run evals:check`
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const casesDir = path.join(repoRoot, "evals", "cases");
const SEVERITIES = new Set(["critical", "major", "minor"]);

let failures = 0;
const fail = (message) => {
  console.error(`  FAIL  ${message}`);
  failures += 1;
};

const caseDirs = readdirSync(casesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(casesDir, entry.name))
  .sort();

for (const caseDir of caseDirs) {
  const label = path.relative(repoRoot, caseDir);
  console.log(label);

  const keyPath = path.join(caseDir, "case.json");
  if (!existsSync(keyPath)) {
    fail(`${label}: no case.json`);
    continue;
  }

  let key;
  try {
    key = JSON.parse(readFileSync(keyPath, "utf8"));
  } catch (cause) {
    fail(`${label}/case.json does not parse: ${cause.message}`);
    continue;
  }

  const root = path.join(caseDir, key.rootDir);
  if (!existsSync(root)) fail(`rootDir "${key.rootDir}" does not exist`);
  if (!existsSync(path.join(caseDir, key.diffPath))) fail(`diffPath "${key.diffPath}" does not exist`);

  for (const rel of key.paths) {
    if (!existsSync(path.join(root, rel))) fail(`paths[] entry "${rel}" does not resolve under rootDir`);
  }

  const seen = new Set();
  for (const entry of [...key.flaws, ...key.decoys]) {
    if (seen.has(entry.id)) fail(`duplicate id "${entry.id}"`);
    seen.add(entry.id);

    const target = path.join(root, entry.file);
    if (!existsSync(target)) {
      fail(`${entry.id}: file "${entry.file}" does not resolve under rootDir`);
      continue;
    }

    const lines = readFileSync(target, "utf8").split("\n");
    if (!Number.isInteger(entry.line) || entry.line < 1 || entry.line > lines.length) {
      fail(`${entry.id}: line ${String(entry.line)} is outside ${entry.file} (1-${String(lines.length)})`);
      continue;
    }

    // Range alone is not enough. Editing the fixture shifts every line below the edit, and a
    // reference that lands on the wrong line is still "in range" — so it stays wrong silently,
    // and the eval keeps grading against code the answer key never meant. `anchor` is a substring
    // the referenced line must still contain, which turns that drift into a failed gate.
    if (typeof entry.anchor !== "string" || entry.anchor.length === 0) {
      fail(`${entry.id}: no anchor. Every flaw and decoy needs one to survive a fixture edit.`);
      continue;
    }
    if (!lines[entry.line - 1].includes(entry.anchor)) {
      fail(
        `${entry.id}: ${entry.file}:${String(entry.line)} no longer contains ${JSON.stringify(entry.anchor)}.\n` +
          `        line reads: ${lines[entry.line - 1].trim()}\n` +
          `        Re-anchor case.json against the current fixture, then re-run.`,
      );
      continue;
    }

    console.log(
      `  ok    ${entry.id.padEnd(30)} ${`${entry.file}:${String(entry.line)}`.padEnd(46)} ${lines[entry.line - 1].trim().slice(0, 56)}`,
    );
  }

  for (const flaw of key.flaws) {
    if (!SEVERITIES.has(flaw.severity)) fail(`${flaw.id}: unknown severity "${flaw.severity}"`);
  }
}

if (failures > 0) {
  console.error(`\n${String(failures)} problem(s) found.`);
  process.exit(1);
}
console.log("\nAll case answer keys validate.");
