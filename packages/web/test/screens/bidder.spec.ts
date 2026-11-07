import type { Page } from '@playwright/test';
import { t } from '../../src/copy/t';
import {
  alertOf,
  expect,
  openRoom,
  test,
  type Envelope,
  type RoomOptions,
} from './support/harness';
import {
  HAPPY,
  ambiguous_confirm,
  failed_needs_review,
  happy,
  nearCeiling,
  noBids,
  paused,
  receiptCapturing,
  receiptFailed,
  receiptFallback,
  receiptLoser,
  receiptNoHold,
  receiptWinner,
  soft_close,
  soldNoSettlement,
  stopped,
  unsold,
} from './support/frames';
import type { ClientMessage, ServerMessage } from '../../src/wire';

/**
 * The bidder room on a phone-first layout: idle, live bidding, winning, outbid, rejections,
 * confirmation sheet, soft close, paused, closed, sold, unsold, stopped, offline and refused
 * joins, then the receipts that follow a sale. The room socket is answered from scenario frames.
 */

type Bidder = Pick<RoomOptions, 'scenario' | 'at'> & Partial<RoomOptions>;

async function bidder(page: Page, opts: Bidder): Promise<void> {
  await openRoom(page, { role: 'bidder', route: 'bid', ...opts });
}

async function settled(page: Page): Promise<void> {
  await page.locator('main').first().waitFor({ state: 'attached' });
}

test.describe('bid: live states', () => {
  test('no bids yet', async ({ page, shoot }) => {
    await bidder(page, { scenario: noBids, at: 0 });
    await expect(page.getByText(t('bid.status.none')).first()).toBeVisible();
    await shoot('bid', 'live-no-bids');
  });

  test('another bidder leads', async ({ page, shoot }) => {
    await bidder(page, { scenario: happy, at: HAPPY.firstBid });
    await settled(page);
    await shoot('bid', 'live-someone-else-leads');
  });

  test('winning', async ({ page, shoot }) => {
    await bidder(page, { scenario: happy, at: HAPPY.winning });
    await expect(page.getByText(t('bid.status.leading')).first()).toBeVisible();
    await shoot('bid', 'live-winning');
  });

  test('outbid', async ({ page, shoot }) => {
    await bidder(page, { scenario: happy, at: HAPPY.outbid });
    await expect(page.getByText(t('bid.status.outbid')).first()).toBeVisible();
    await shoot('bid', 'live-outbid');
  });

  test('near the ceiling', async ({ page, shoot }) => {
    await bidder(page, { scenario: nearCeiling, at: 3_500 });
    await settled(page);
    await shoot('bid', 'live-near-ceiling');
  });

  test('soft close extended', async ({ page, shoot }) => {
    await bidder(page, { scenario: soft_close, at: 38_600 });
    await settled(page);
    await shoot('bid', 'live-soft-close-extended');
  });

  test('paused', async ({ page, shoot }) => {
    await bidder(page, { scenario: paused, at: 2_500 });
    await expect(page.getByText(t('bid.paused')).first()).toBeVisible();
    await shoot('bid', 'paused');
  });
});

function rejectWith(reason: string) {
  return (msg: ClientMessage, next: () => Envelope): ServerMessage[] =>
    msg.t === 'bid'
      ? [
          {
            v: 1,
            t: 'bid_rejected',
            ...next(),
            mid: msg.mid,
            reason,
            retryable: false,
          } as ServerMessage,
        ]
      : [];
}

test.describe('bid: sending a bid', () => {
  const reasons = ['over_ceiling', 'below_increment', 'closed', 'already_leading', 'below_reserve'];
  for (const reason of reasons) {
    test(`rejected: ${reason}`, async ({ page, shoot }) => {
      await bidder(page, { scenario: happy, at: HAPPY.outbid, reply: rejectWith(reason) });
      await page.getByRole('button', { name: /^Bid / }).first().click();
      await expect(alertOf(page)).toBeVisible();
      await shoot('bid', `rejected-${reason.replace(/_/g, '-')}`);
    });
  }

  test('waiting for the answer', async ({ page, shoot }) => {
    await bidder(page, { scenario: happy, at: HAPPY.outbid });
    await page.getByRole('button', { name: /^Bid / }).first().click();
    await expect(page.getByText(t('bid.status.pending')).first()).toBeVisible();
    await shoot('bid', 'bid-pending');
  });

  test('no answer, safe to resend', async ({ page, shoot }) => {
    await bidder(page, { scenario: happy, at: HAPPY.outbid });
    await page.getByRole('button', { name: /^Bid / }).first().click();
    await expect(page.getByText(t('bid.unknown')).first()).toBeVisible({ timeout: 20_000 });
    await shoot('bid', 'bid-no-answer');
  });

  test('custom amount typed', async ({ page, shoot }) => {
    await bidder(page, { scenario: happy, at: HAPPY.outbid });
    await page.getByLabel(t('bid.custom')).fill('900');
    await shoot('bid', 'custom-amount-over-ceiling');
  });
});

test.describe('bid: voice confirmation', () => {
  test('confirmation sheet', async ({ page, shoot }) => {
    await bidder(page, { scenario: ambiguous_confirm, at: 3_500 });
    await expect(page.getByRole('button', { name: t('confirm.yes') })).toBeVisible();
    await shoot('bid', 'confirm-sheet');
  });

  test('confirmation answered', async ({ page, shoot }) => {
    await bidder(page, { scenario: ambiguous_confirm, at: 3_500 });
    await page.getByRole('button', { name: t('confirm.yes') }).click();
    await expect(page.getByText(t('confirm.answered')).first()).toBeVisible();
    await shoot('bid', 'confirm-answered');
  });
});

test.describe('bid: after the hammer', () => {
  test('closed, sold to this bidder', async ({ page, shoot }) => {
    await bidder(page, { scenario: soldNoSettlement, at: 4_000 });
    await expect(page.getByText(t('bid.closedBanner')).first()).toBeVisible();
    await shoot('bid', 'closed-sold-to-me');
  });

  test('closed, no sale', async ({ page, shoot }) => {
    await bidder(page, { scenario: unsold, at: 4_000 });
    await expect(page.getByText(t('bid.closedBanner')).first()).toBeVisible();
    await shoot('bid', 'closed-unsold');
  });

  test('stopped by the operator', async ({ page, shoot }) => {
    await bidder(page, { scenario: stopped, at: 2_500 });
    await expect(page.getByText(t('bid.stoppedBanner')).first()).toBeVisible();
    await shoot('bid', 'stopped');
  });
});

test.describe('bid: connection and refusals', () => {
  test('offline', async ({ page, shoot }) => {
    await bidder(page, { scenario: happy, at: HAPPY.winning, dropAfterJoin: true });
    await expect(page.getByText(t('net.offline')).first()).toBeVisible({ timeout: 30_000 });
    await shoot('bid', 'offline');
  });

  test('room full', async ({ page, shoot }) => {
    await bidder(page, { scenario: happy, at: 0, joinError: { code: 'room_full' } });
    await expect(page.getByText(t('err.room.full')).first()).toBeVisible();
    await shoot('bid', 'refused-room-full');
  });

  test('rate limited', async ({ page, shoot }) => {
    await bidder(page, {
      scenario: happy,
      at: 0,
      joinError: { code: 'rate_limited', retryAfterMs: 12_000 },
    });
    await expect(page.getByText(/Too many attempts/).first()).toBeVisible();
    await shoot('bid', 'refused-rate-limited');
  });

  test('link expired', async ({ page, shoot }) => {
    await bidder(page, { scenario: happy, at: 0, joinError: { code: 'unauthorized' } });
    await expect(page.getByText(t('err.tokenMissing')).first()).toBeVisible();
    await shoot('bid', 'refused-link-expired');
  });

  test('waiting for the server', async ({ page, shoot }) => {
    await bidder(page, { scenario: happy, at: 0, silent: true });
    await settled(page);
    await shoot('bid', 'connecting');
  });
});

test.describe('receipt', () => {
  async function receipt(
    page: Page,
    scenario: RoomOptions['scenario'],
    paddle: number,
  ): Promise<void> {
    await openRoom(page, { scenario, at: 6_000, role: 'bidder', route: 'receipt', paddle });
  }

  test('winner, charged', async ({ page, shoot }) => {
    await receipt(page, receiptWinner, 12);
    await expect(page.getByRole('heading', { name: t('receipt.title') })).toBeVisible();
    await shoot('receipt', 'winner-charged');
  });

  test('winner, capture in progress', async ({ page, shoot }) => {
    await receipt(page, receiptCapturing, 12);
    await expect(page.getByRole('heading', { name: t('receipt.title') })).toBeVisible();
    await shoot('receipt', 'winner-capturing');
  });

  test('did not win, hold released', async ({ page, shoot }) => {
    await receipt(page, receiptLoser, 9);
    await expect(page.getByRole('heading', { name: t('receipt.title') })).toBeVisible();
    await shoot('receipt', 'not-winner-released');
  });

  test('capture failed, needs review', async ({ page, shoot }) => {
    await receipt(page, receiptFailed, 12);
    await expect(page.getByRole('heading', { name: t('receipt.title') })).toBeVisible();
    await shoot('receipt', 'failed-needs-review');
  });

  test('runner-up charged after the winner hold expired', async ({ page, shoot }) => {
    await receipt(page, receiptFallback, 7);
    await expect(page.getByRole('heading', { name: t('receipt.title') })).toBeVisible();
    await shoot('receipt', 'runner-up-fallback');
  });

  test('offline, showing the last receipt', async ({ page, shoot }) => {
    await receipt(page, receiptWinner, 12);
    await expect(page.getByRole('heading', { name: t('receipt.title') })).toBeVisible();
    await page.context().setOffline(true);
    await expect(page.getByText(t('state.offline')).first()).toBeVisible();
    await shoot('receipt', 'offline');
  });

  test('no hold of its own', async ({ page, shoot }) => {
    await receipt(page, receiptNoHold, 12);
    await settled(page);
    await shoot('receipt', 'no-hold');
  });

  test('before the hammer: no receipt yet', async ({ page, shoot }) => {
    await openRoom(page, { scenario: happy, at: HAPPY.winning, role: 'bidder', route: 'receipt' });
    await settled(page);
    await shoot('receipt', 'none-yet');
  });

  test('settlement failed room, bidder view', async ({ page, shoot }) => {
    await openRoom(page, {
      scenario: failed_needs_review,
      at: 14_500,
      role: 'bidder',
      route: 'bid',
    });
    await settled(page);
    await shoot('bid', 'closed-settlement-review');
  });
});
