#!/usr/bin/env node
// PostToolUse (Write|Edit) hook: lint ONLY the file the agent just edited.
//
// Reads the hook payload from stdin, pulls tool_input.file_path, and runs
// ESLint on that single file. On lint errors it prints the report and exits 2
// (blocking), so Claude Code feeds the output back into context and the agent
// can self-correct on its next turn. Non-lintable paths are a no-op (exit 0).

import { spawnSync } from "node:child_process";

const LINTABLE = /\.(ts|tsx|js|jsx|astro)$/;

let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let file = "";
  try {
    file = JSON.parse(raw)?.tool_input?.file_path ?? "";
  } catch {
    process.exit(0); // unparseable payload — do nothing
  }

  if (!file || !LINTABLE.test(file)) process.exit(0);

  const result = spawnSync("npx", ["eslint", file], {
    encoding: "utf8",
    shell: true, // needed on Windows so npx.cmd resolves
  });

  if (result.status === 0) process.exit(0);

  const report = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  process.stderr.write(report || `eslint exited with code ${result.status} for ${file}\n`);
  process.exit(2);
});
