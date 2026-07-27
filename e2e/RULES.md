# E2E Testing Rules

Read this before writing or generating anything under `e2e/`. It is one of the two quality
levers for this layer; `e2e/seed.spec.ts` is the other — model new specs on it, because what
the seed shows is what a generator reproduces.

## The rules

- Use `getByRole`, `getByLabel`, `getByText` as primary locators. Fall back to `getByTestId`
  only when accessibility attributes are ambiguous.
- Never use CSS selectors, XPath, or DOM structure for locating elements.
- Each test must be independently runnable — no shared state between tests. The suite runs
  `fullyParallel`.
- Never use `page.waitForTimeout()`. Wait for a condition: `toBeVisible()`, `waitForURL()`,
  `waitForResponse()`.
- Assert the business outcome, not implementation details.
- Use unique identifiers (timestamp suffix) for test data so parallel runs and re-runs don't
  collide, and clean up what the test created. **If the row is created before the first assertion
  that can fail, the cleanup belongs in `test.afterEach`, not at the end of the test body** —
  otherwise it only ever runs on green and every red run leaks a row into the shared `E2E_EMAIL`
  account, accumulating across re-runs. `removeRowsTitled` in `e2e/helpers/cleanup.ts` is the
  shared shape: it asserts the deletion on a passing test and degrades to best-effort on a failing
  one, so a cleanup throw can never mask the real failure.
- Use `storageState` for authentication — never log in through the UI inside a spec. The
  `setup` project already did it; see `e2e/auth.setup.ts`.
- Name the test after the risk it protects: `test("manually added game survives a page
  reload", …)`, not `test("test 1", …)`.
- **Reaching a file input goes through `filechooser`, not a CSS selector.** The gallery input
  carries no label, no id, and no role (`src/components/library/PhotoCapture.tsx:189-195`), so
  `getByRole`/`getByLabel` cannot see it. Click the *role-located* button and catch the event:

  ```ts
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add via photo" }).click();
  await (await chooser).setFiles(filePath);
  ```

  It fires even for the island's programmatic `ref.current?.click()`. `page.locator('input[type=
  "file"]')` is the documented fallback if it ever stops firing — and if you need it, say in-file
  that the missing accessible name is a gap in the app, not a rule bent quietly.
- **Click an island's trigger with a retry, not a sleep.** Astro islands ship interactive-*looking*
  SSR HTML before React attaches (`PhotoCapture` is `client:load`, `EntryRowActions` is
  `client:visible`), so a click landing in that window is swallowed with no error and no effect. A
  spec that reaches a trigger immediately after `goto` loses this race (both photo specs did, while
  being written; `seed.spec.ts` never does, because unrelated round-trips hydrate it first). Wrap
  the click in `expect(async () => { … }).toPass()` waiting on what it should reveal —
  `clickUntilRevealed` in `e2e/helpers/hydration.ts` is the shared shape; import it rather than
  re-copying it. That is still a wait-for-state: a genuinely broken affordance fails the block.
  `photo-gallery-desktop.spec.ts`'s `pickFileUntilChooserOpens` is the same guard for a trigger
  whose effect is a file chooser rather than a DOM node.

## What earns a spec here

This is the most expensive and most flake-prone layer in the project, so the budget is tight:
**one test per risk**, and the risk has to be one no cheaper layer can prove.

A risk belongs in `e2e/` when it crosses several real boundaries at once (auth → routing →
API → Supabase) or exists only in the rendered, interactive UI. If an isolated function, a
route-contract test, or a pgTAP policy test could prove it, it belongs there instead —
`context/foundation/test-plan.md` §4 maps each layer, and §3 names the risks.

Concretely, in this repo:

| Prove it here | Prove it one layer down |
|---|---|
| A journey through the real middleware, SSR page, API route, and DB | A single endpoint's status/shape/auth gating → `src/pages/api/**/*.test.ts` |
| State that only exists after hydration (dialogs, comboboxes, islands) | Pure logic: normalizers, validators, the recommender → `src/lib/**/*.test.ts` |
| Data surviving a real SSR reload or navigation | Cross-user isolation → `supabase/tests/database/*.test.sql` (`npm run test:db`) |

## Real vs mocked

E2E does not mean zero mocking, but the split is not negotiable:

- **Real, always:** Supabase auth, the middleware, routing, and the database. That's where
  integration risk hides — a spec that mocks auth and the DB asserts nothing that could break
  in integration.
- **Mock at the network layer:** expensive or non-deterministic *external* providers — IGDB
  and the OpenRouter vision call. Caveat that bites on this stack: those are called
  **server-side** from Astro routes, so browser-level `page.route()` will not intercept them.
  Mock them where the server calls out, or pick a flow that doesn't reach them.

### `page.route()` *can* see the app's own routes

The caveat above is about the **Worker → OpenRouter/IGDB** hop only. `POST /api/identify` is the
island's own same-origin `fetch` (`PhotoCapture.tsx:137`), so `page.route("**/api/identify", …)` does
intercept it. Use that to **add headers and `continue()`** — never to fulfil a canned response, which
would delete the route, the DB, and the SSR re-render from the test:

```ts
await page.route("**/api/identify", async (route) => {
  await route.continue({
    headers: { ...route.request().headers(), "x-e2e-vision-key": STUB_KEY, "x-e2e-vision-title": title },
  });
});
```

### The vision determinism seam

`stubbedVisionRead` (`src/lib/services/vision.ts`) replaces **the provider network hop and nothing
else**: a request carrying a header that matches the server-side `E2E_VISION_STUB_KEY` gets a canned
`identified` read, and the route's auth gate, multipart parse, size/mime validation, base64 encode,
`vision.ts`'s **normalizers**, grounding, the insert, and the SSR re-render all still run for real.
Rules for using it, and for any seam like it:

- **A seam replaces a network call, never a normalizer.** Stub past `normalizeTitleCasing` /
  `normalizePlatformLabel` and every §6.2 assertion about normalize-before-ground goes hollow at the
  one layer that could still have caught it. Pick a title the normalizers leave alone (mixed case +
  a numeric suffix) so the value you assert on is the value you sent.
- **Two locks, both absent in production**: the secret must be set *and* the request must present
  it. Its ten guard cases live in `src/lib/services/vision.test.ts`; the whole Vitest suite runs
  with the key `undefined` (`test/stubs/astro-env-server.ts`), so it is continuous evidence that the
  default state is dead. Never set it in a deployed environment.
- **The key lives in two files and they must match**: `.dev.vars` (the dev server reads it) and
  `.env` (`playwright.config.ts:22` loads it so the spec can send the header). See `.env.example`.
  **`.dev.vars` beats `process.env` in wrangler and Astro binds secrets at worker init — so edit it,
  then restart the dev server**, or `reuseExistingServer` hands you a server still holding the old
  value and the spec fails with the real provider's 502.
- Assert `response.status()` on the intercepted request. A disarmed seam then reads as "the POST
  502'd" instead of an unexplained dialog timeout three assertions later.

### Fake camera: both launch args, or the spec silently tests the wrong path

`getUserMedia` needs **both** flags, per-file via `test.use({ launchOptions: { args: [...] } })`:

```ts
"--use-fake-device-for-media-stream",                  // without it: NotFoundError
"--use-fake-ui-for-media-stream",                      // without it: NotSupportedError, even after grantPermissions(["camera"])
`--use-file-for-fake-video-capture=${absoluteY4mPath}` // byte-deterministic frames; path must be absolute
```

Either omission fails **silently in the app's favour**: `CameraCapture` routes to `onError` and the
UI falls back to the gallery picker, so the spec passes green while exercising the file-input path it
was written to avoid. The permanent guard is an assertion, not a comment — `CameraCapture`'s Capture
button is `disabled={!ready}` and `ready` flips only when `getUserMedia` resolves, so **"the camera
dialog is visible and Capture is enabled" *is* "getUserMedia succeeded"**. Keep it in any camera spec.
These flags are Chromium-only, which is one reason WebKit is declined here (test-plan §4).

## The control question

For every assertion: **would this fail if the risk in `test-plan.md` actually came true?**
If not, the assertion is decorative. Confirm it by deliberately breaking the production
behavior the risk targets and watching the test go red — then revert the break. Never commit
one.

Never use `test.skip()` / `test.fixme()` to get a green run. A spec that can't pass against
the real app is a signal to investigate, not to silence.

## Running

```bash
npx supabase start      # the specs hit real Supabase
npm run test:e2e        # whole suite (starts the dev server itself)
npm run test:e2e -- e2e/seed.spec.ts   # a single spec
npm run test:e2e:ui     # watch/debug mode
```

Requires `E2E_EMAIL` / `E2E_PASSWORD` in `.env` — see `.env.example`.
