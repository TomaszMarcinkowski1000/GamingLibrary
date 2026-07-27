import { expect, type Page } from "@playwright/test";

import { clickUntilRevealed } from "./hydration";

/**
 * Delete every library row matching `title`, through the UI, as the signed-in e2e user.
 *
 * Call it from a `test.afterEach` rather than at the end of a test body. Both photo specs persist
 * their row server-side the moment the identify POST returns — *before* the first assertion that
 * can fail — so an in-body delete only ever ran on green, and every red run leaked a row
 * permanently into the shared `E2E_EMAIL` account, accumulating across re-runs. Manual criteria
 * 3.4 / 4.4 ("no rows left behind") are meant to hold unconditionally.
 *
 * `passed` decides how loudly it fails. On a green run the deletion is asserted, so a broken
 * cleanup is a real failure. On a red one it is best-effort: the page may be sitting under a modal,
 * and throwing from a cleanup hook would replace the real failure with a misleading one.
 *
 * Falsified rather than assumed (2026-07-27, `photo-gallery-desktop.spec.ts`): a forced failure
 * immediately after the identify 200 leaves **1** row behind with this hook stubbed out, and **0**
 * with it live.
 *
 * The loop (rather than `seed.spec.ts`'s single delete) is the F3 tolerance
 * (`context/archive/2026-06-17-photo-to-library/reviews/impl-review.md`) — if the 30 s abort seam
 * ever duplicates a row, this still leaves the library clean instead of failing on a count nobody
 * owns here.
 */
export async function removeRowsTitled(page: Page, title: string, { passed }: { passed: boolean }) {
  const rows = page.getByRole("row", { name: new RegExp(title) });

  try {
    // A fresh SSR render is the cheapest way back to a deletable list when a failure left the page
    // mid-dialog. Skipped on green, where the test already ended on a freshly-rendered `/library`.
    if (!passed) await page.goto("/library");

    for (let remaining = await rows.count(); remaining > 0; remaining = await rows.count()) {
      const confirm = page.getByRole("alertdialog");
      await clickUntilRevealed(rows.first().getByRole("button", { name: "Delete" }), confirm);
      await confirm.getByRole("button", { name: "Delete" }).click();
      await expect(rows).toHaveCount(remaining - 1);
    }
  } catch (error) {
    if (passed) throw error;
    // Deliberate: the run has already failed, and a leaked row is something the next reader of the
    // report needs to know about. Swallowing it silently is what this whole helper exists to avoid.
    // eslint-disable-next-line no-console
    console.warn(`[cleanup] "${title}" may remain in the library after a failed run: ${String(error)}`);
  }
}
