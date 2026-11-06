import { expect, test } from '../src/fixtures/base';
import { hammerRoom, seedRoom } from '../src/fixtures/room';
import { AuctioneerView, BidderView, PublicView } from '../src/pages/views';

/**
 * Browser happy path, scenario S01 entry (R-QA-031, T-QA-045): the visitor opens the app and starts
 * a demo auction. The web app routes the start button to the /demo screen; the room creation and
 * the role links on that screen are not wired in the app yet, so the first test stops at the route.
 * Bidding and settlement through the UI are not covered here yet, and neither is the audit view
 * (it needs a reviewer token the seeded room does not mint). The second test walks the seeded room
 * through the bidder, public and auctioneer page objects (src/pages/views.ts) up to the hammer.
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
