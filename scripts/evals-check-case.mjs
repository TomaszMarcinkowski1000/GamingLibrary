#!/usr/bin/env node
/*
 * Structural gate over every eval case's answer key.
 *
 * `case.json` is the artifact that outlives the runner: the flaw and decoy prose is what an
 * LLM judge grades a review against, and every `line` in it is a claim about a specific line of
 * the `after/` tree. Those claims go stale silently — reformat a fixture, add an import, and the
 * key still parses while pointing at the wrong code. This script re-checks them mechanically.
 *
 * It verifies, per case: the JSON parses and satisfies `evals/case.ts`'s schema — imported rather
 * than restated, so the two validators cannot disagree about severities or required fields —
 * and then the claims that schema cannot check: `rootDir` and `diffPath` exist, every `paths[]`
 * entry and every flaw/decoy `file` exists under `rootDir`, every `line` is in range and still
 * carries its `anchor`, and ids are unique.
 *
 * Usage: `npm run evals:check`
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evalCaseSchema } from "../evals/case.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const casesDir = path.join(repoRoot, "evals", "cases");

let failures = 0;
const fail = (message) => {
  console.error(`  FAIL  ${message}`);
  failures += 1;
};

/**
 * Existence is not containment: `../../..` exists too.
 *
 * `rootDir` is the sandbox root the agent's `read_file` is confined to, so a key pointing above the
 * case folder would hand the model the repository — `.env` and its keys included — and the model
 * could echo what it read back through `findings[]`. The "resolves under rootDir" wording below is
 * older than this check; the check is what makes it true.
 */
const contains = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
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

  let raw;
  try {
    raw = JSON.parse(readFileSync(keyPath, "utf8"));
  } catch (cause) {
    fail(`${label}/case.json does not parse: ${cause.message}`);
    continue;
  }

  // The structural pass runs `evals/case.ts`'s own schema rather than a second opinion about the
  // same file. It used to be a hand-restated severity list plus unguarded property reads, which
  // gave two failure modes at once: a flaw marked `info` passed zod at runtime and failed here,
  // and a key missing `flaws` died with `TypeError: key.flaws is not iterable` instead of the FAIL
  // line this script exists to print. Node strips the types on import, so there is one schema.
  const parsed = evalCaseSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      fail(`${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    continue;
  }
  const key = parsed.data;

  const root = path.resolve(caseDir, key.rootDir);
  if (!contains(caseDir, root)) {
    fail(`rootDir "${key.rootDir}" escapes the case folder — it is the agent's sandbox root`);
    continue;
  }
  if (!existsSync(root)) fail(`rootDir "${key.rootDir}" does not exist`);

  const diffTarget = path.resolve(caseDir, key.diffPath);
  if (!contains(caseDir, diffTarget)) fail(`diffPath "${key.diffPath}" escapes the case folder`);
  else if (!existsSync(diffTarget)) fail(`diffPath "${key.diffPath}" does not exist`);

  for (const rel of key.paths) {
    const target = path.resolve(root, rel);
    if (!contains(root, target)) fail(`paths[] entry "${rel}" escapes rootDir`);
    else if (!existsSync(target)) fail(`paths[] entry "${rel}" does not resolve under rootDir`);
  }

  const seen = new Set();
  for (const entry of [...key.flaws, ...key.decoys]) {
    if (seen.has(entry.id)) fail(`duplicate id "${entry.id}"`);
    seen.add(entry.id);

    const target = path.resolve(root, entry.file);
    if (!contains(root, target)) {
      fail(`${entry.id}: file "${entry.file}" escapes rootDir`);
      continue;
    }
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
}

if (failures > 0) {
  console.error(`\n${String(failures)} problem(s) found.`);
  process.exit(1);
}
console.log("\nAll case answer keys validate.");
