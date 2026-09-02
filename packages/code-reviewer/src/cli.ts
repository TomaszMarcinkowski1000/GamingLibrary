import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { reviewCode } from "./agent/index.ts";
import { loadConfig } from "./config.ts";
import { createModel } from "./model.ts";

/* eslint-disable no-console -- this CLI entry point reports to stdout by design */

/**
 * Picks the review root for a target file. The working directory wins when the
 * file sits inside it, so the agent can follow imports across the project;
 * otherwise the root shrinks to the file's own directory.
 */
function resolveTarget(target: string): { rootDir: string; path: string } {
  const absolute = resolve(target);
  const cwd = resolve(process.cwd());
  const fromCwd = relative(cwd, absolute);

  if (fromCwd !== "" && !isAbsolute(fromCwd) && fromCwd !== ".." && !fromCwd.startsWith(`..${sep}`)) {
    return { rootDir: cwd, path: fromCwd.split(sep).join("/") };
  }

  return { rootDir: dirname(absolute), path: basename(absolute) };
}

/**
 * Smoke-test entry point: `npm start -- <file>` reviews one file. Real
 * integrations should import `reviewCode` rather than shell out to this.
 */
async function main(): Promise<void> {
  const target = argv[2];
  if (target === undefined || target === "") {
    throw new Error("Usage: npm start -- <file>");
  }

  const { rootDir, path } = resolveTarget(target);
  const review = await reviewCode({ model: createModel(loadConfig()), rootDir, paths: [path] });

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
