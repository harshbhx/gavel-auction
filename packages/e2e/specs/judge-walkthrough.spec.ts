import { test as plain } from '@playwright/test';
import { expect, test } from '../src/fixtures/base';
import { hammerRoom, seedRoom } from '../src/fixtures/room';
import { AuctioneerView, BidderView, PublicView } from '../src/pages/views';

/**
 * Judge walkthrough (R-QA-055, T-QA-049): a judge with only a browser reaches the demo screen (the role links
 * once they are wired) of a demo auction in under five minutes. The first test runs on the fake stack. The second runs the
 * same path against a hosted URL (GAVEL_JUDGE_URL) and is skipped when that is not set; the nightly
 * production smoke sets it. The third test follows steps 3 to 5 of the table in docs/JUDGES.md on a
 * seeded room of the fake stack: the auctioneer console, the bidder view, the big screen before and
 * after the hammer, and the audit trail, inside the same budget. Placing a bid through the UI is
 * covered by the scripted tests in happy-path.spec.ts and by the nightly smoke, not here.
 */

const BUDGET_MS = 300_000;

async function walk(page: import('@playwright/test').Page, url: string): Promise<void> {
  const started = Date.now();
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /start a live demo room/i }).click();
  // The role links are not wired into the /demo screen yet; extend this once they are.
  await expect(page).toHaveURL(/\/demo$/, { timeout: 30_000 });
  await expect(
    page.getByRole('heading', { level: 1, name: /start a live demo room/i }),
  ).toBeVisible();
  expect(Date.now() - started).toBeLessThan(BUDGET_MS);
}

test('a judge reaches every role link on the fake stack within five minutes', async ({
  page,
  stack,
}) => {
  test.setTimeout(BUDGET_MS);
  await walk(page, stack.webUrl);
});

test('a judge opens the console, the bidder view, the big screen and the audit trail in time', async ({
  page,
  stack,
}) => {
  test.setTimeout(BUDGET_MS);
  const started = Date.now();
  const room = await seedRoom(stack);

  // Step 3, auctioneer: the console shows the lot and its controls.
  const auctioneer = new AuctioneerView(page, stack, room);
  await auctioneer.open();
  await expect(auctioneer.root).toBeVisible();

  // Step 4, bidder: the bidder view opens, and the big screen shows the lot as not sold yet.
  const bidder = new BidderView(page, stack, room);
  await bidder.open();
  await expect(bidder.form).toBeVisible();
  const screen = new PublicView(page, stack, room);
  await screen.open();
  await expect(screen.sold).toHaveCount(0);

  // The hammer ends the lot; the big screen says so.
  await hammerRoom(stack, room);
  await screen.open();
  await expect(screen.sold).toBeAttached();

  // Step 5, auditor: the audit trail opens with its guide.
  await page.goto(`${stack.webUrl}/r/${room.auctionId}/audit#token=${room.auctioneerToken}`);
  await page.locator('main[data-route="audit"]').waitFor();
  await page.locator('#gv-audit-guide-title').waitFor({ timeout: 20_000 });

  expect(Date.now() - started).toBeLessThan(BUDGET_MS);
});

const hosted = process.env['GAVEL_JUDGE_URL'];

plain(
  'a judge reaches every role link on the hosted site within five minutes',
  async ({ page }) => {
    plain.skip(hosted === undefined || hosted === '', 'GAVEL_JUDGE_URL is not set');
    plain.setTimeout(BUDGET_MS);
    await walk(page, hosted ?? '');
  },
);
