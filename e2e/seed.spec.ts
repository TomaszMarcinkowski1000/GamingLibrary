import { expect, test } from "@playwright/test";

/**
 * The seed test — the exemplar every other spec in this directory is modeled on.
 *
 * It is deliberately not a throwaway smoke test. Whatever this file shows, a generator
 * reproduces: role-based locators here mean role-based locators everywhere, and one
 * `waitForTimeout` here would propagate into every spec that follows. Read `e2e/RULES.md`
 * before changing it.
 *
 * The four patterns it demonstrates:
 *   1. Role-based locators only — no CSS, no XPath, no DOM structure.
 *   2. Full independence — its own setup, action, assertion, and cleanup, with a
 *      timestamped title so parallel runs and re-runs can't collide.
 *   3. Waits on state (`toBeVisible`, `toHaveCount`), never on time.
 *   4. A name and an assertion bound to a real risk, not to the implementation.
 *
 * Why this flow earns a browser: a manual add crosses every boundary at once — Supabase
 * auth cookie → middleware → the hydrated React dialog → POST /api/library → RLS-scoped
 * insert → a fresh SSR render of the list. No unit or route-contract test spans that; the
 * failure it catches is "the UI said saved, the database disagreed".
 *
 * On the external boundary: POST /api/library enriches through IGDB server-side, so
 * `page.route()` could not intercept it even if we wanted to. It doesn't need to — the
 * service swallows enrichment failure into `metadata_status: no_match`, and a timestamped
 * title never matches anything, so the outcome is the same whether IGDB answers or not.
 * The assertions below stay clear of metadata for exactly that reason.
 */

test("manually added game is still in the library after a reload", async ({ page }) => {
  const title = `E2E Seed Game ${String(Date.now())}`;
  const platform = "PC";
  const row = page.getByRole("row", { name: new RegExp(title) });

  await page.goto("/library");

  // Setup + action: add the game through the real dialog.
  await page.getByRole("button", { name: "Add manually" }).click();
  const addDialog = page.getByRole("dialog", { name: "Add a game" });
  await addDialog.getByRole("textbox", { name: "Title" }).fill(title);
  // The platform trigger carries `role="combobox"` but no accessible name (its <label> isn't
  // wired to it), so scope by the dialog rather than reaching for a CSS selector.
  await addDialog.getByRole("combobox").click();
  await page.getByRole("option", { name: platform, exact: true }).click();
  await addDialog.getByRole("button", { name: "Save", exact: true }).click();

  // A successful add keeps the dialog open and flips it into edit mode — that swap is the
  // app's own "it persisted" signal, so wait on it instead of a timeout.
  const editDialog = page.getByRole("dialog", { name: "Edit game" });
  await expect(editDialog).toBeVisible();
  await editDialog.getByRole("button", { name: "Close" }).click();
  await expect(row).toBeVisible();

  // The assertion that carries the risk: a full round-trip to the server has to still find
  // the entry. Client state can't fake this — a reload re-runs the SSR query as this user.
  await page.reload();
  await expect(row).toBeVisible();
  await expect(row.getByRole("cell", { name: platform })).toBeVisible();

  // Cleanup: remove what this test created, and assert the removal actually took.
  await row.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);
});
