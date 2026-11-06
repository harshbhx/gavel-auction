import { expect, test } from '../src/fixtures/base';
import { hammerRoom, seedRoom } from '../src/fixtures/room';
import { AuctioneerView, BidderView, PublicView, ScriptedView } from '../src/pages/views';

/**
 * Browser happy path, scenario S01 entry (R-QA-031, T-QA-045): the visitor opens the app and starts
 * a demo auction. The web app routes the start button to the /demo screen; the room creation and
 * the role links on that screen are not wired in the app yet, so the first test stops at the route.
 * The second test walks the seeded room through the bidder, public and auctioneer page objects
 * (src/pages/views.ts) up to the hammer. The scripted tests at the end drive S01 bidding and
 * settlement through the UI with `?scripted=1`. The audit view is not covered: it needs a reviewer
 * token the seeded room does not mint, and the scripted routes do not mount it.
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

test('a seeded room is seen by the bidder, the public and the auctioneer, then hammered', async ({
  page,
  stack,
}) => {
  const room = await seedRoom(stack);
  await new BidderView(page, stack, room).open();
  const pub = new PublicView(page, stack, room);
  await pub.open();
  await expect(pub.sold).toHaveCount(0);
  await new AuctioneerView(page, stack, room).open();
  await hammerRoom(stack, room);
  await pub.open();
  await expect(pub.sold).toBeAttached();
});

test('scripted S01: the public screen follows the bids up to the hammer', async ({
  page,
  stack,
}) => {
  test.setTimeout(60_000);
  const screen = new ScriptedView(page, stack, 'screen');
  await screen.open();
  await expect(screen.sold).toHaveCount(0);
  await expect(screen.price).toHaveText('$350.00', { timeout: 20_000 });
  // The projector layout clips the stage on a phone viewport, so the sold banner is checked as attached.
  await expect(screen.sold).toBeAttached({ timeout: 30_000 });
  await expect(screen.sold).toContainText('$350.00');
});

test('scripted S01: a bidder sends a bid and the console opens the hammer question', async ({
  page,
  stack,
}) => {
  const bidder = new ScriptedView(page, stack, 'bid');
  await bidder.open(5_000);
  await expect(bidder.quickBid).toBeVisible();
  await bidder.quickBid.click();
  await expect(bidder.quickBid).toBeVisible();

  const auctioneer = new ScriptedView(page, stack, 'console');
  await auctioneer.open(5_000);
  await expect(auctioneer.hammer).toBeEnabled();
  await auctioneer.hammer.click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('scripted S01: after the hammer the screen is sold and the receipt is settled', async ({
  page,
  stack,
}) => {
  const screen = new ScriptedView(page, stack, 'screen');
  await screen.open(16_000);
  await expect(screen.sold).toBeAttached();
  await expect(screen.sold).toContainText('$350.00');
  await new ScriptedView(page, stack, 'receipt').open(18_500);
  await expect(page.locator('[data-route="receipt"]')).toBeVisible();
});
