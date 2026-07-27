import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the browser-level (e2e) layer — see
 * `context/foundation/test-plan.md` §3 Phase 4 and §6.3 for what belongs here.
 *
 * The cheap layers stay in Vitest (`npm test`): pure functions, route contracts via direct
 * handler invocation, and RLS via pgTAP (`npm run test:db`). A test earns a spec in this
 * directory only when it crosses several real boundaries at once (auth → routing → API →
 * Supabase) or exists only in the rendered, interactive UI.
 *
 * Prerequisites for a local run:
 *   1. `npx supabase start` — the specs hit the real local Supabase, never a stub.
 *   2. `E2E_EMAIL` / `E2E_PASSWORD` in `.env` — a confirmed user in that local instance.
 * Both are asserted with a readable failure in `e2e/auth.setup.ts` rather than a timeout.
 */

// `.env` carries the e2e account credentials (Node-side). The dev server reads its own
// SUPABASE_* secrets from `.dev.vars` via the Cloudflare adapter, so this is additive, not a
// substitute. Absent file → the setup project fails with its own message.
try {
  process.loadEnvFile(".env");
} catch {
  // Optional: CI may inject E2E_EMAIL / E2E_PASSWORD as real environment variables instead.
}

const PORT = 4321;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const IS_CI = Boolean(process.env.CI);

/** Where `auth.setup.ts` parks the signed-in cookie jar. Gitignored — it holds a real session. */
export const STORAGE_STATE = "e2e/.auth/user.json";

export default defineConfig({
  testDir: "./e2e",
  // Every spec owns its setup, data, and cleanup, so files may run concurrently.
  fullyParallel: true,
  forbidOnly: IS_CI,
  // No local retries: a test that only passes on attempt 2 is flake to fix, not to hide.
  retries: IS_CI ? 2 : 0,
  workers: IS_CI ? 1 : undefined,
  reporter: IS_CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    // Signs in once through the real API route and saves the session; every other project
    // depends on it, so no spec ever logs in through the UI.
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
    // Risk #3 (mobile camera capture) is a per-spec concern, not a whole extra project:
    // the spec that needs it declares `test.use({ ...devices["Pixel 5"] })` itself, so the
    // rest of the suite doesn't pay for a second full run.
  ],

  // `astro dev` runs the app on the real workerd runtime, same as `npm run dev`.
  // Cold start on this stack is slow, hence the generous timeout.
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !IS_CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
