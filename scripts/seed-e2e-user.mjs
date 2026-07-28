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
 * Idempotent AND convergent: re-running against a stack that already holds the account resets
 * that account to the requested E2E_PASSWORD and re-confirms it, rather than just detecting the
 * collision and reporting success. The distinction is load-bearing because CI generates a fresh
 * password per run (.github/workflows/ci.yml). On any warm stack — `act`, a self-hosted runner,
 * a persisted Docker volume, or a developer who edited .env — a detect-only script seeds nothing,
 * exits 0, and then fails three steps later at e2e/auth.setup.ts's "sign-in bounced back to
 * /auth/signin", with nothing in the log pointing back here.
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

function adminHeaders(serviceRoleKey) {
  return {
    "Content-Type": "application/json",
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
}

/**
 * Finds the existing account so we can reset it. Two measured facts about GoTrue's admin list
 * endpoint drive the shape here (probed against v2.188.1, 2026-07-28):
 *
 *   - The filter parameter is `filter`, not `email`. An unrecognised `?email=…` is SILENTLY
 *     IGNORED and the endpoint returns every user — so a script that trusted it would happily
 *     reset the first unrelated account it got back.
 *   - `filter` is a PARTIAL match (`?filter=e2e` returns `e2e@example.com`). Hence the exact,
 *     case-insensitive comparison below; it is the actual correctness check, not a formality.
 */
async function findUserByEmail(supabaseUrl, serviceRoleKey, email) {
  const url = new URL("/auth/v1/admin/users", supabaseUrl);
  url.searchParams.set("filter", email);
  url.searchParams.set("per_page", "100");

  const response = await fetch(url, { headers: adminHeaders(serviceRoleKey) });
  const body = await response.text();
  if (!response.ok) return { error: `admin list failed with ${response.status}: ${body}` };

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { error: `admin list returned a non-JSON body` };
  }

  const users = Array.isArray(parsed?.users) ? parsed.users : [];
  const target = email.toLowerCase();
  return { user: users.find((candidate) => candidate?.email?.toLowerCase() === target) ?? null };
}

/** Converges the existing account on the requested state: the password we were given, confirmed. */
async function resetUser(supabaseUrl, serviceRoleKey, userId, password) {
  const url = new URL(`/auth/v1/admin/users/${userId}`, supabaseUrl);
  const response = await fetch(url, {
    method: "PUT",
    headers: adminHeaders(serviceRoleKey),
    body: JSON.stringify({ password, email_confirm: true }),
  });
  const body = await response.text();
  return response.ok ? {} : { error: `admin update failed with ${response.status}: ${body}` };
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
      headers: adminHeaders(serviceRoleKey),
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
    // Converge rather than shrug. The account existing is not the same as the account being
    // usable: CI hands us a freshly generated password every run, so on a warm stack the
    // stored hash is for a password nobody will present.
    const { user, error: lookupError } = await findUserByEmail(supabaseUrl, serviceRoleKey, email);
    if (lookupError) {
      fail(redact(lookupError, [serviceRoleKey, password]));
    }
    if (!user) {
      fail(
        `${email} is already registered, but the admin list endpoint did not return it — ` +
          `GoTrue's filter contract has changed, so the password cannot be reset. Recreate the ` +
          `stack (\`npx supabase stop --no-backup\`) or fix findUserByEmail().`,
      );
    }

    const { error: resetError } = await resetUser(supabaseUrl, serviceRoleKey, user.id, password);
    if (resetError) {
      fail(redact(resetError, [serviceRoleKey, password]));
    }

    console.log(`seed-e2e-user: ${email} already existed at ${endpoint.origin} — password reset, confirmed`);
    return;
  }

  fail(`admin create failed with ${response.status}: ${redact(body, [serviceRoleKey, password])}`);
}

// Every path inside main() redacts before printing; an unexpected throw would bypass all of them
// and print an unhandled rejection instead. This script is the one place in the repo holding both
// a service-role key and the e2e password, so the last resort redacts too.
try {
  await main();
} catch (error) {
  fail(redact(`unexpected failure: ${String(error)}`, [process.env.SERVICE_ROLE_KEY, process.env.E2E_PASSWORD]));
}
