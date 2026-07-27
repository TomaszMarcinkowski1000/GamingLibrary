/*
 * E2E account seeder — creates the confirmed `E2E_EMAIL` / `E2E_PASSWORD` user in a LOCAL
 * Supabase instance, so `e2e/auth.setup.ts` can sign in through the real `/api/auth/signin`
 * route (see e2e/RULES.md: the specs' auth is not a mock).
 *
 * Why GoTrue's admin API rather than an `insert into auth.users`: sign-in needs more than a
 * row in that one table — an `identities` record, the right `aud`/`role`, a correctly hashed
 * password. Letting GoTrue author all of it is the difference between a user that works and
 * one that fails with an opaque schema error at login.
 *
 * Usage (local):
 *   npx supabase start
 *   eval "$(npx supabase status -o env)"
 *   SUPABASE_URL="$API_URL" SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
 *     E2E_EMAIL=... E2E_PASSWORD=... npm run seed:e2e-user
 *
 * CI calls it the same way (.github/workflows/ci.yml, `e2e` job).
 *
 * Idempotent: re-running against a stack that already holds the account is a success, which is
 * what makes it safe on warm Docker volumes and on CI re-runs.
 */

import process from "node:process";

const REQUIRED_VARS = ["SUPABASE_URL", "SERVICE_ROLE_KEY", "E2E_EMAIL", "E2E_PASSWORD"];

// The e2e account is never a production account (test-plan §7, .env.example) — the suite creates
// and deletes library rows in it. A script that carries a service-role key should not be one typo
// away from doing that against a real project, so the guard is on by default and has to be
// switched off deliberately.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function fail(message) {
  console.error(`seed-e2e-user: ${message}`);
  process.exit(1);
}

/**
 * Keeps the service-role key and the password out of anything we print. GoTrue does not echo
 * either back, but error bodies are pass-through text and this script is the one place in the
 * repo holding both — so redact rather than trust.
 */
function redact(text, secrets) {
  return secrets.filter(Boolean).reduce((acc, secret) => acc.split(secret).join("[redacted]"), text);
}

/** GoTrue answers a duplicate signup with 422 `email_exists`; older builds used 400 and prose. */
function isAlreadyRegistered(status, body) {
  if (status !== 422 && status !== 400) return false;
  const haystack = body.toLowerCase();
  return (
    haystack.includes("email_exists") ||
    haystack.includes("already been registered") ||
    haystack.includes("already registered")
  );
}

async function main() {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    fail(`missing required environment variable(s): ${missing.join(", ")}`);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SERVICE_ROLE_KEY;
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  let hostname;
  try {
    hostname = new URL(supabaseUrl).hostname;
  } catch {
    fail(`SUPABASE_URL is not a valid URL`);
  }

  if (!LOCAL_HOSTS.has(hostname) && process.env.ALLOW_REMOTE_SEED !== "1") {
    fail(
      `refusing to seed a non-local instance (host "${hostname}"). The e2e account creates and ` +
        `deletes rows and must never be a production account. Set ALLOW_REMOTE_SEED=1 to override.`,
    );
  }

  const endpoint = new URL("/auth/v1/admin/users", supabaseUrl);

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      // `email_confirm: true` is passed explicitly rather than leaning on
      // supabase/config.toml's `enable_confirmations = false`, so the script keeps producing a
      // sign-in-ready account if that flag is ever flipped.
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
  } catch (error) {
    fail(`could not reach ${endpoint.origin} — is \`npx supabase start\` running? (${String(error)})`);
  }

  const body = await response.text();

  if (response.ok) {
    console.log(`seed-e2e-user: created ${email} (confirmed) at ${endpoint.origin}`);
    return;
  }

  if (isAlreadyRegistered(response.status, body)) {
    console.log(`seed-e2e-user: ${email} already exists at ${endpoint.origin} — nothing to do`);
    return;
  }

  fail(`admin create failed with ${response.status}: ${redact(body, [serviceRoleKey, password])}`);
}

await main();
