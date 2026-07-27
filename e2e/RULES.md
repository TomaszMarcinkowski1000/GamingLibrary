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
  collide, and clean up what the test created.
- Use `storageState` for authentication — never log in through the UI inside a spec. The
  `setup` project already did it; see `e2e/auth.setup.ts`.
- Name the test after the risk it protects: `test("manually added game survives a page
  reload", …)`, not `test("test 1", …)`.

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
