import type { Page } from '@playwright/test';
import { t } from '../../src/copy/t';
import { expect, openRoom, test, type RoomOptions } from './support/harness';
import {
  HAPPY,
  auditRoom,
  happy,
  noBids,
  paused,
  scheduled,
  soft_close,
  soldNoSettlement,
  stopped,
  unsold,
} from './support/frames';

/**
 * The public big screen (lobby, live, soft close, sold, passed, settlement, stopped, frozen when
 * offline) and the audit trail (table, filters, detail drawer, empty, loading and refused).
 */

type Opts = Pick<RoomOptions, 'scenario' | 'at'> & Partial<RoomOptions>;

async function screen(page: Page, opts: Opts): Promise<void> {
  await openRoom(page, { role: 'screen', route: 'screen', ...opts });
  await page.locator('main.gv-screen').waitFor();
}

async function audit(page: Page, opts: Opts): Promise<void> {
  await openRoom(page, { role: 'reviewer', route: 'audit', ...opts });
}

test.describe('screen', () => {
  test('lobby, lot not opened', async ({ page, shoot }) => {
    await screen(page, { scenario: scheduled, at: 0 });
    await shoot('screen', 'lobby-not-opened');
  });

  test('lobby, open with no bids', async ({ page, shoot }) => {
    await screen(page, { scenario: noBids, at: 0 });
    await shoot('screen', 'lobby-no-bids');
  });

  test('live, first bid', async ({ page, shoot }) => {
    await screen(page, { scenario: happy, at: HAPPY.firstBid });
    await shoot('screen', 'live-first-bid');
  });

  test('live, bidding war', async ({ page, shoot }) => {
    await screen(page, { scenario: happy, at: HAPPY.outbid });
    await shoot('screen', 'live-bidding');
  });

  test('live, soft close extended', async ({ page, shoot }) => {
    await screen(page, { scenario: soft_close, at: 38_600 });
    await shoot('screen', 'live-soft-close-extended');
  });

  test('paused', async ({ page, shoot }) => {
    await screen(page, { scenario: paused, at: 2_500 });
    await shoot('screen', 'paused');
  });

  test('sold, settlement pending', async ({ page, shoot }) => {
    await screen(page, { scenario: soldNoSettlement, at: 4_000 });
    await expect(page.getByTestId('sold')).toBeAttached();
    await shoot('screen', 'sold');
  });

  test('sold, settlement in progress', async ({ page, shoot }) => {
    await screen(page, { scenario: happy, at: HAPPY.capturing });
    await expect(page.getByTestId('sold')).toBeAttached();
    await shoot('screen', 'sold-settlement-in-progress');
  });

  test('sold, settled', async ({ page, shoot }) => {
    await screen(page, { scenario: happy, at: HAPPY.settled });
    await expect(page.getByTestId('sold')).toBeAttached();
    await shoot('screen', 'sold-settled');
  });

  test('passed, no sale', async ({ page, shoot }) => {
    await screen(page, { scenario: unsold, at: 4_000 });
    await expect(page.getByTestId('sold')).toBeAttached();
    await shoot('screen', 'passed');
  });

  test('stopped by the operator', async ({ page, shoot }) => {
    await screen(page, { scenario: stopped, at: 2_500 });
    await shoot('screen', 'stopped');
  });

  test('offline, clock frozen', async ({ page, shoot }) => {
    await openRoom(page, {
      role: 'screen',
      route: 'screen',
      scenario: happy,
      at: HAPPY.outbid,
      dropAfterJoin: true,
    });
    await expect(page.getByText(t('screen.clockFrozen')).first()).toBeVisible({ timeout: 30_000 });
    await shoot('screen', 'offline-frozen');
  });

  test('room full', async ({ page, shoot }) => {
    await openRoom(page, {
      role: 'screen',
      route: 'screen',
      scenario: happy,
      at: 0,
      joinError: { code: 'room_full' },
    });
    await expect(page.getByText(t('err.room.full')).first()).toBeVisible();
    await shoot('screen', 'refused-room-full');
  });
});

test.describe('audit', () => {
  test('table with every outcome', async ({ page, shoot }) => {
    await audit(page, { scenario: auditRoom, at: 9_000 });
    await expect(page.getByRole('table')).toBeVisible();
    await shoot('audit', 'table');
  });

  test('filtered to rejected rows', async ({ page, shoot }) => {
    await audit(page, { scenario: auditRoom, at: 9_000, query: 'result=rejected' });
    await expect(page.getByRole('table')).toBeVisible();
    await shoot('audit', 'filtered-rejected');
  });

  test('filtered to voice below 60 percent', async ({ page, shoot }) => {
    await audit(page, { scenario: auditRoom, at: 9_000, query: 'source=voice&conf=60' });
    await expect(page.getByRole('table')).toBeVisible();
    await shoot('audit', 'filtered-voice-low-confidence');
  });

  test('filters match nothing', async ({ page, shoot }) => {
    await audit(page, { scenario: auditRoom, at: 9_000, query: 'q=zzzz' });
    await expect(page.getByText(t('audit.empty')).first()).toBeVisible();
    await shoot('audit', 'filtered-no-match');
  });

  test('row detail drawer', async ({ page, shoot }) => {
    await audit(page, { scenario: auditRoom, at: 9_000 });
    await page.locator('tbody tr th button').nth(1).click();
    await page.getByRole('dialog').waitFor();
    await shoot('audit', 'row-drawer');
  });

  test('no events yet', async ({ page, shoot }) => {
    await audit(page, { scenario: noBids, at: 0 });
    await expect(page.getByText(t('audit.empty')).first()).toBeVisible();
    await shoot('audit', 'empty');
  });

  test('loading', async ({ page, shoot }) => {
    await audit(page, { scenario: auditRoom, at: 9_000, silent: true });
    await expect(page.getByText(t('state.loading')).first()).toBeVisible();
    await shoot('audit', 'loading');
  });

  test('offline', async ({ page, shoot }) => {
    await audit(page, { scenario: auditRoom, at: 9_000 });
    await expect(page.getByRole('table')).toBeVisible();
    // The browser reports it is offline; the page keeps what it had and says so.
    await page.context().setOffline(true);
    await expect(page.getByText(t('state.offline')).first()).toBeVisible();
    await shoot('audit', 'offline');
  });

  test('link without a token', async ({ page, shoot }) => {
    await audit(page, { scenario: auditRoom, at: 9_000, withoutToken: true });
    await expect(page.getByText(t('err.tokenMissing')).first()).toBeVisible();
    await shoot('audit', 'token-missing');
  });

  test('token refused by the server', async ({ page, shoot }) => {
    await audit(page, { scenario: auditRoom, at: 9_000, joinError: { code: 'unauthorized' } });
    await expect(page.getByText(t('err.tokenMissing')).first()).toBeVisible();
    await shoot('audit', 'token-refused');
  });
});
