import { readFile } from "node:fs/promises";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.ts";
import { createModel, reviewCode } from "./review.ts";

export { loadConfig } from "./config.ts";
export type { Config } from "./config.ts";
export { createModel, reviewCode, findingSchema, reviewSchema, severities } from "./review.ts";
export type { Finding, Review, ReviewOptions } from "./review.ts";

/* eslint-disable no-console -- this CLI entry point reports to stdout by design */

/**
 * Smoke-test entry point: `npm start -- <file>` reviews a file, or reviews a
 * built-in snippet when given no argument. Real integrations should import
 * `reviewCode` rather than shell out to this.
 */
async function main(): Promise<void> {
  const target = argv[2];
  const code = target
    ? `// ${target}\n${await readFile(target, "utf8")}`
    : `// example.ts\nexport function half(xs: number[]) {\n  return xs.slice(0, xs.length / 2);\n}`;

  const config = loadConfig();
  const review = await reviewCode({ model: createModel(config), code });

  console.log(review.summary);
  for (const finding of review.findings) {
    console.log(`\n[${finding.severity}] ${finding.file}:${finding.line} — ${finding.title}`);
    console.log(`  ${finding.detail}`);
    if (finding.suggestion) console.log(`  fix: ${finding.suggestion}`);
  }
  if (review.findings.length === 0) console.log("\nNo findings.");
}

// Only run when executed directly, so importing this module stays side-effect free.
if (import.meta.url === pathToFileURL(argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
