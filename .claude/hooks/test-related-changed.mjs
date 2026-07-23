#!/usr/bin/env node
// PostToolUse (Write|Edit) hook: run ONLY the tests related to the edited file,
// and ONLY when that file lives in the top risk area from test-plan.md.
//
// Highest risk = Risk #1 "photo path attaches the wrong game / edition / metadata"
// (test-plan.md §2), covered by Phase 1 (grounding & identify-seam integration).
// That risk lives in the hot-spot directory src/lib/services/ — so this gate
// fires only there. Editing anything else is a no-op: we do NOT run tests on
// every helper, component, or config edit (test-plan.md / lesson rule).
//
// On the risk area it runs `vitest related <file> --run` (related = only test
// files whose module graph imports the edited file; --run = no watch mode) and
// exits 2 on failure so Claude Code feeds the output back and the agent reacts.
//
// AI_AGENT=1 asks Vitest (4.1+) for compact, agent-friendly output so the
// feedback fed back to the model stays small. This repo runs Vitest 4.1.10.

import { spawnSync } from "node:child_process";

const RISK_AREA = "src/lib/services/";
const TESTABLE = /\.(ts|tsx)$/;

let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let file = "";
  try {
    file = JSON.parse(raw)?.tool_input?.file_path ?? "";
  } catch {
    process.exit(0); // unparseable payload — do nothing
  }

  const normalized = file.replace(/\\/g, "/");
  if (!normalized.includes(RISK_AREA) || !TESTABLE.test(normalized)) {
    process.exit(0); // outside the risk area — do not run tests
  }

  const result = spawnSync("npx", ["vitest", "related", file, "--run"], {
    encoding: "utf8",
    shell: true, // needed on Windows so npx.cmd resolves
    env: { ...process.env, AI_AGENT: "1" }, // compact, agent-friendly output (Vitest 4.1+)
  });

  if (result.status === 0) process.exit(0);

  const report = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  process.stderr.write(report || `vitest related exited with code ${result.status} for ${file}\n`);
  process.exit(2);
});
