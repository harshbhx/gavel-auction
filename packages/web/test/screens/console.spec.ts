import type { Page } from '@playwright/test';
import { t } from '../../src/copy/t';
import { expect, openRoom, test, type RoomOptions } from './support/harness';
import {
  HAPPY,
  ambiguous_confirm,
  failed_needs_review,
  happy,
  ladderFailed,
  ladderRoom,
  noBids,
  paused,
  scheduled,
  soft_close,
  soldNoSettlement,
  stopped,
  unsold,
  voiceRoom,
} from './support/frames';

/**
 * The auctioneer console in every phase of a lot: setup, live, voice feed and confirmations,
 * hammer and stop dialogs, settlement and the ladder, plus the audit trail and the public big
 * screen. The room socket is answered from scenario frames.
 */

type Opts = Pick<RoomOptions, 'scenario' | 'at'> & Partial<RoomOptions>;

async function consoleRoom(page: Page, opts: Opts): Promise<void> {
  await openRoom(page, { role: 'auctioneer', route: 'console', ...opts });
  await page.getByRole('button', { name: t('console.hammer'), exact: true }).waitFor();
}

test.describe('console: setup and live', () => {
  test('setup, lot not opened', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: scheduled, at: 0 });
    await shoot('console', 'setup-not-opened');
  });

  test('live, no bids', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: noBids, at: 0 });
    await shoot('console', 'live-no-bids');
  });

  test('live, bidding', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: happy, at: HAPPY.outbid });
    await shoot('console', 'live-bidding');
  });

  test('live, soft close extended', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: soft_close, at: 38_600 });
    await shoot('console', 'live-soft-close-extended');
  });

  test('paused', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: paused, at: 2_500 });
    await shoot('console', 'paused');
  });
});

test.describe('console: voice and confirmations', () => {
  test('voice feed and parse chips', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: voiceRoom, at: 5_000 });
    await shoot('console', 'voice-feed-transcripts');
  });

  test('confirmation waiting for an answer', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: ambiguous_confirm, at: 3_500 });
    await shoot('console', 'confirm-queue');
  });
});

test.describe('console: hammer and stop', () => {
  test('hammer dialog with a leader', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: happy, at: HAPPY.outbid });
    await page.getByRole('button', { name: t('console.hammer'), exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await shoot('console', 'hammer-dialog');
  });

  test('hammer dialog with no bids', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: noBids, at: 0 });
    await page.getByRole('button', { name: t('console.hammer'), exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await shoot('console', 'hammer-dialog-no-bids');
  });

  test('stop dialog', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: happy, at: HAPPY.outbid });
    await page.getByRole('button', { name: t('kill.button') }).click();
    await page.getByRole('dialog').waitFor();
    await shoot('console', 'stop-dialog');
  });

  test('stop dialog with the phrase typed', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: happy, at: HAPPY.outbid });
    await page.getByRole('button', { name: t('kill.button') }).click();
    await page.getByRole('dialog').getByLabel(t('kill.type')).fill('STOP');
    await shoot('console', 'stop-dialog-armed');
  });

  test('auction stopped', async ({ page, shoot }) => {
    await openRoom(page, { role: 'auctioneer', route: 'console', scenario: stopped, at: 2_500 });
    await expect(page.getByText(t('kill.stopped')).first()).toBeVisible();
    await shoot('console', 'stopped');
  });
});

test.describe('console: after the hammer', () => {
  test('sold, settlement pending', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: soldNoSettlement, at: 4_000 });
    await shoot('console', 'sold-settlement-pending');
  });

  test('passed, no sale', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: unsold, at: 4_000 });
    await shoot('console', 'passed-no-sale');
  });

  test('settlement in progress', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: happy, at: HAPPY.capturing });
    await expect(page.getByText(t('console.settlement.inProgress')).first()).toBeVisible();
    await shoot('console', 'settlement-in-progress');
  });

  test('settled, ladder counts', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: happy, at: HAPPY.settled });
    await shoot('console', 'settled-counts');
  });

  test('settled, full ladder', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: ladderRoom, at: 5_000 });
    await shoot('console', 'settled-full-ladder');
  });

  test('settlement needs review', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: failed_needs_review, at: 14_500 });
    await expect(page.getByText(t('console.settlement.reviewNoRunnerUp')).first()).toBeVisible();
    await shoot('console', 'settlement-needs-review');
  });

  test('settlement needs review, full ladder', async ({ page, shoot }) => {
    await consoleRoom(page, { scenario: ladderFailed, at: 5_000 });
    await expect(page.getByText(t('console.settlement.reviewNoRunnerUp')).first()).toBeVisible();
    await shoot('console', 'settlement-needs-review-full-ladder');
  });
});

test.describe('console: connection and refusals', () => {
  test('offline', async ({ page, shoot }) => {
    await openRoom(page, {
      role: 'auctioneer',
      route: 'console',
      scenario: happy,
      at: HAPPY.outbid,
      dropAfterJoin: true,
    });
    await page.getByRole('button', { name: t('console.hammer'), exact: true }).waitFor();
    await expect(page.getByText(t('controls.reason.offline')).first()).toBeVisible({
      timeout: 30_000,
    });
    await shoot('console', 'offline');
  });

  test('link without a token', async ({ page, shoot }) => {
    await openRoom(page, {
      role: 'auctioneer',
      route: 'console',
      scenario: happy,
      at: 0,
      withoutToken: true,
    });
    await expect(page.getByText(t('err.tokenMissing')).first()).toBeVisible();
    await shoot('console', 'token-missing');
  });

  test('token refused by the server', async ({ page, shoot }) => {
    await openRoom(page, {
      role: 'auctioneer',
      route: 'console',
      scenario: happy,
      at: 0,
      joinError: { code: 'unauthorized' },
    });
    await expect(page.getByText(t('err.tokenMissing')).first()).toBeVisible();
    await shoot('console', 'token-refused');
  });
});
