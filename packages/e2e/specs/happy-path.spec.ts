import { expect, test } from '../src/fixtures/base';

/**
 * Browser happy path, scenario S01 entry (R-QA-031, T-QA-045): the visitor opens the app and starts
 * a demo auction. The web app routes the start button to the /demo screen; the room creation and
 * the role links on that screen are not wired in the app yet, so this spec stops at the route.
 * Bidding and settlement through the UI are not covered here yet.
 */

test('start a demo auction and see the role links', async ({ page, stack }) => {
  await page.goto(stack.webUrl);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /start a demo auction/i }).click();
  await expect(page).toHaveURL(/\/demo$/, { timeout: 20_000 });
  await expect(
    page.getByRole('heading', { level: 1, name: /start a demo auction/i }),
  ).toBeVisible();
});
