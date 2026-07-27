import { expect, type Locator } from "@playwright/test";

/**
 * Click an island's trigger and wait for what it should reveal, retrying the click if nothing
 * appeared.
 *
 * Not a disguised sleep — the retry waits on state, and a genuinely broken affordance still fails
 * the block. It exists because Astro islands ship interactive-*looking* SSR HTML before React
 * attaches: `PhotoCapture` is `client:load` and `EntryRowActions` is `client:visible`
 * (`src/pages/library/index.astro:188,261`), so a click landing in that window is swallowed with no
 * error and no visible effect. `seed.spec.ts` never hits it because every trigger it touches has
 * had seconds of unrelated round-trips to hydrate; the two photo specs reach their triggers
 * immediately after a page load, and lost the race twice while being written — once on the
 * dropdown, once on a row's Delete. Worth knowing it is also a real (if narrow) UX property, not a
 * test artifact.
 *
 * See `e2e/RULES.md` — "Click an island's trigger with a retry, not a sleep."
 */
export async function clickUntilRevealed(trigger: Locator, revealed: Locator) {
  await expect(async () => {
    await trigger.click();
    await expect(revealed).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}
