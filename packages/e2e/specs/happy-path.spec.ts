import { expect, test } from '../src/fixtures/base';

/**
 * Browser happy path, scenario S01 entry (R-QA-031, T-QA-045): the visitor opens the app, starts a
 * demo auction against the real server, and reaches the room with a link for every role.
 * Bidding and settlement through the UI are not covered here yet.
 */

test('start a demo auction and see the role links', async ({ page, stack }) => {
  await page.goto(stack.webUrl);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /start a demo auction/i }).click();
  await expect(page.getByText(/big screen/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/auctioneer console/i).first()).toBeVisible();
  await expect(page.getByText(/audit trail/i).first()).toBeVisible();
});
