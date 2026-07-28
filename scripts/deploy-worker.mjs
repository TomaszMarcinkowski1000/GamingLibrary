/*
 * Production deploy — builds, ships the Worker, and hands Sentry the source maps for the exact
 * bundle that went out. Invoked as `npm run deploy`; it replaces a bare `npx wrangler deploy`.
 *
 * Why a script rather than the `@sentry/astro` integration the obvious search result suggests:
 * that integration uploads the maps Astro's *vite* build produced, and it turns on the browser
 * SDK by default (~269 kB into every page, which this project explicitly does not want — see
 * context/changes/sentry-error-monitoring/plan.md, "What We're NOT Doing"). What actually runs in
 * production is `dist/server`, which `@astrojs/cloudflare` marks `no_bundle: true`, so wrangler
 * copies it to the edge module-for-module. Uploading *that* directory is what makes a production
 * stack trace point at real `src/` lines.
 *
 * Order is load-bearing:
 *
 *   build -> inject -> deploy -> upload
 *
 * `sentry-cli sourcemaps inject` stamps a debug ID into each chunk *and* its .map, which is how
 * Sentry pairs an event to the right artifact. The injection has to happen BEFORE the deploy, or
 * the code at the edge carries no debug ID and the maps we upload can never be matched to it.
 *
 * Sentry credentials are optional. With none set the script still builds and deploys, and only
 * skips the upload — the same "unset is a valid configuration" stance the DSN takes in
 * sentry.server.config.ts. That keeps a deploy possible for anyone without a Sentry account.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const SERVER_OUTPUT = "dist/server";
const SENTRY_VARS = ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"];

/**
 * These three live in `.env` on the deploying developer's machine (see .env.example), not in
 * `.dev.vars` — they are build/deploy credentials, not Worker runtime bindings. Anything already
 * exported in the shell wins over the file, so a one-off `SENTRY_ORG=... npm run deploy` behaves
 * the way that syntax implies.
 */
function loadDotEnv() {
  if (!existsSync(".env")) return;
  const preset = new Map(Object.entries(process.env));
  process.loadEnvFile(".env");
  for (const [key, value] of preset) process.env[key] = value;
}

/** @param {string} command @param {string[]} args */
function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  // `shell: true` because wrangler/sentry-cli resolve to .cmd shims on Windows, which execFile
  // cannot spawn directly. No argument here is user-supplied, so there is nothing to quote around.
  const { status, error } = spawnSync(command, args, { stdio: "inherit", shell: true });
  if (error) fail(`${command} could not be started: ${error.message}`);
  if (status !== 0) fail(`${command} exited with code ${status}`);
}

/** @param {string} message */
function fail(message) {
  console.error(`deploy-worker: ${message}`);
  process.exit(1);
}

/**
 * The commit being deployed, used as the Sentry release so an issue says *which* deploy
 * introduced it. Read at deploy time and passed to the Worker as a plain var; the entrypoint
 * reads it back as `env.SENTRY_RELEASE` (sentry.server.config.ts).
 *
 * @returns {string | undefined}
 */
function resolveRelease() {
  const { status, stdout } = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", shell: true });
  if (status !== 0) return undefined;
  const sha = stdout.trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
}

loadDotEnv();

const missing = SENTRY_VARS.filter((name) => !process.env[name]);
const uploadSourceMaps = missing.length === 0;
const release = resolveRelease();

if (!uploadSourceMaps) {
  console.warn(
    `deploy-worker: ${missing.join(", ")} not set — deploying without source-map upload.\n` +
      `             Production stack traces will stay minified. See .env.example.`,
  );
}
if (!release) {
  console.warn("deploy-worker: could not resolve a git SHA — deploying without a Sentry release tag.");
}

run("npm", ["run", "build"]);

if (!existsSync(SERVER_OUTPUT)) {
  fail(`${SERVER_OUTPUT} does not exist after the build — nothing to deploy.`);
}

// Stamps debug IDs into dist/server/**/*.mjs and their .map siblings. Must precede the deploy.
if (uploadSourceMaps) {
  run("npx", ["sentry-cli", "sourcemaps", "inject", SERVER_OUTPUT]);
}

run("npx", ["wrangler", "deploy", ...(release ? ["--var", `SENTRY_RELEASE:${release}`] : [])]);

if (uploadSourceMaps) {
  run("npx", [
    "sentry-cli",
    "sourcemaps",
    "upload",
    "--org",
    process.env.SENTRY_ORG ?? "",
    "--project",
    process.env.SENTRY_PROJECT ?? "",
    ...(release ? ["--release", release] : []),
    SERVER_OUTPUT,
  ]);
  console.log("\ndeploy-worker: deployed, source maps uploaded.");
} else {
  console.log("\ndeploy-worker: deployed. Source-map upload skipped.");
}
