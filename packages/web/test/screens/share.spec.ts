import { Cents, type RoomSnapshot } from '@gavel/shared';
import { t } from '../../src/copy/t';
import { auctionId, bidderId, openSnapshot, roster } from '../../src/testing/builders';
import { receiptWinner } from './support/frames';
import { expect, mockApi, openRoom, test } from './support/harness';

/**
 * UX-05: the receipt share controls (link, QR, copy, print) for the signed-in bidder, and a
 * receipt opened from a share link with no session at all. The server is answered from the test.
 */

const ROOM = auctionId();
// A receipt token is far longer than this, so the QR is drawn at its real density.
const TOKEN = `${'A'.repeat(210)}.${'B'.repeat(43)}`;

function sharedSnapshot(): RoomSnapshot {
  const own = roster([2, 'Ben'])[0];
  const winner = roster([1, ''])[0];
  if (own === undefined || winner === undefined) throw new Error('fixture');
  return {
    ...openSnapshot([winner, own], undefined, 'DONE', ROOM),
    lotTitle: 'Signed first-press vinyl',
    hammer: { winnerId: bidderId(1), price: Cents(35000) },
    settlement: {
      rev: 4,
      auctionState: 'SETTLED',
      you: 'SETTLED',
      yourHold: {
        bidderId: bidderId(2),
        idSuffix: 'EF34GH',
        status: 'VOIDED',
        ceilingCents: Cents(30000),
        capturedCents: Cents(0),
        releasedCents: Cents(30000),
        remainder: 'none',
      },
    },
  };
}

test.describe('share receipt', () => {
  test('share controls with link and QR', async ({ page, shoot }) => {
    await mockApi(page, (req) =>
      req.method === 'POST' && req.path.endsWith('/receipt-link')
        ? { status: 200, json: { token: TOKEN, link: '', expiresAt: 1_768_478_400_000 } }
        : { status: 404 },
    );
    await openRoom(page, {
      scenario: receiptWinner,
      at: 6_000,
      role: 'bidder',
      route: 'receipt',
      paddle: 12,
    });
    await expect(page.getByRole('heading', { name: t('receipt.title') })).toBeVisible();
    await page.getByRole('button', { name: t('receipt.share.create') }).click();
    await expect(page.getByLabel(t('receipt.share.field'))).toBeVisible();
    await expect(page.locator('.gv-share__qr svg')).toBeVisible();
    await shoot('receipt-share', 'link-and-qr');
  });

  test('opened from a link, signed out', async ({ page, shoot }) => {
    await mockApi(page, (req) =>
      req.method === 'GET' && req.path === `/api/auctions/${ROOM}/receipt`
        ? {
            status: 200,
            json: {
              bidderId: bidderId(2),
              snapshot: sharedSnapshot(),
              expiresAt: 1_768_478_400_000,
            },
          }
        : { status: 404 },
    );
    await page.goto(`/r/${ROOM}/receipt#token=${TOKEN}`);
    await expect(page.getByRole('heading', { name: t('receipt.title') })).toBeVisible();
    await expect(page.getByText(t('receipt.shared.readOnly'))).toBeVisible();
    await shoot('receipt-share', 'opened-signed-out');
  });

  test('opened from an expired link', async ({ page, shoot }) => {
    await mockApi(page, () => ({ status: 401 }));
    await page.goto(`/r/${ROOM}/receipt#token=${TOKEN}`);
    await expect(page.getByText(t('receipt.shared.invalid'))).toBeVisible();
    await shoot('receipt-share', 'expired-link');
  });
});
