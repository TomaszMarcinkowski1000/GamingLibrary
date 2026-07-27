import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test as setup } from "@playwright/test";
import { STORAGE_STATE } from "../playwright.config";

/**
 * Authenticates once for the whole suite and parks the session in `STORAGE_STATE`.
 *
 * Sign-in goes through the real `/api/auth/signin` route — same Supabase SSR cookie the app
 * sets in production — but never through the sign-in *form*. Driving the login UI in every
 * spec is the classic e2e time sink and couples unrelated tests to the auth screen's markup;
 * `storageState` is Playwright's answer. The sign-in form itself is worth its own spec one
 * day, and that spec would deliberately opt out of this state.
 */

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

setup("authenticate", async ({ page, baseURL }) => {
  expect(
    email && password,
    "E2E_EMAIL / E2E_PASSWORD missing. Add a confirmed local-Supabase user to `.env` " +
      "(see .env.example), or export them in CI.",
  ).toBeTruthy();

  // The route reads `request.formData()` and answers with a redirect either way: `/library`
  // on success, `/auth/signin?error=…` on failure. So the status alone proves nothing —
  // the landing URL is the real signal.
  //
  // `Origin` is load-bearing, not decoration: Astro's built-in CSRF guard
  // (`security.checkOrigin`, on by default for SSR) rejects a form-encoded POST whose Origin
  // doesn't match the site with a bare 403. A browser sets it automatically; an API request
  // doesn't, so we set it ourselves.
  const response = await page.request.post("/api/auth/signin", {
    headers: { Origin: baseURL ?? "" },
    form: { email: email ?? "", password: password ?? "" },
  });
  expect(response.ok(), `sign-in POST failed with ${String(response.status())}`).toBeTruthy();
  expect(
    new URL(response.url()).pathname,
    "sign-in bounced back to /auth/signin — check the credentials and that `npx supabase start` is running",
  ).not.toBe("/auth/signin");

  // Prove the cookie actually authenticates a page load: middleware sends anonymous visitors
  // from /library to /auth/signin, so reaching the heading is the assertion that matters.
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "My Library" })).toBeVisible();

  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE });
});
