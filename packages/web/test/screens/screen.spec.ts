import type { Page } from '@playwright/test';
import { t } from '../../src/copy/t';
import { expect, openRoom, test, type RoomOptions } from './support/harness';
import {
  HAPPY,
  auditRoom,
  fundraiser,
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

/** The audit page shows the AG Grid ledger by default; wait until its rows are drawn. */
async function ledgerRows(page: Page): Promise<void> {
  await page.locator('[data-testid="ledger-grid"] .ag-row').first().waitFor();
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

  test('fundraiser thermometer, live', async ({ page, shoot }) => {
    await screen(page, { scenario: fundraiser, at: HAPPY.winning });
    await expect(page.getByText('Raised $0.00 of $1,000.00')).toBeVisible();
    await shoot('screen', 'fundraiser-live');
  });

  test('fundraiser thermometer, amount on hold', async ({ page, shoot }) => {
    await screen(page, { scenario: fundraiser, at: HAPPY.capturing });
    await expect(page.getByText('On hold: $350.00')).toBeVisible();
    await expect(page.getByText('Raised $0.00 of $1,000.00')).toBeVisible();
    await shoot('screen', 'fundraiser-on-hold');
  });

  test('fundraiser thermometer, raised after capture', async ({ page, shoot }) => {
    await screen(page, { scenario: fundraiser, at: HAPPY.settled });
    await expect(page.getByText('Raised $350.00 of $1,000.00')).toBeVisible();
    await shoot('screen', 'fundraiser-raised');
  });

  test('no thermometer without a goal', async ({ page }) => {
    await screen(page, { scenario: happy, at: HAPPY.settled });
    await expect(page.getByText(/Raised/)).toHaveCount(0);
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
    await ledgerRows(page);
    await shoot('audit', 'table');
  });

  test('filtered to rejected rows', async ({ page, shoot }) => {
    await audit(page, { scenario: auditRoom, at: 9_000, query: 'result=rejected' });
    await ledgerRows(page);
    await shoot('audit', 'filtered-rejected');
  });

  test('filtered to voice below 60 percent', async ({ page, shoot }) => {
    await audit(page, { scenario: auditRoom, at: 9_000, query: 'source=voice&conf=60' });
    await ledgerRows(page);
    await shoot('audit', 'filtered-voice-low-confidence');
  });

  test('filters match nothing', async ({ page, shoot }) => {
    await audit(page, { scenario: auditRoom, at: 9_000, query: 'q=zzzz' });
    await expect(page.getByText(t('audit.noMatch')).first()).toBeVisible();
    await shoot('audit', 'filtered-no-match');
  });

  test('row detail drawer', async ({ page, shoot }) => {
    await audit(page, { scenario: auditRoom, at: 9_000 });
    // The grid is the default view: a click on a row opens the page's detail sheet.
    await ledgerRows(page);
    await page
      .locator('[data-testid="ledger-grid"] .ag-center-cols-container .ag-row')
      .nth(1)
      .click();
    await page.getByRole('dialog').waitFor();
    await shoot('audit', 'row-drawer');
  });

  test('timeline and summary after the hammer', async ({ page, shoot }) => {
    await audit(page, { scenario: happy, at: HAPPY.settled });
    await expect(page.getByRole('region', { name: t('audit.tl.title') })).toBeVisible();
    await expect(page.getByText(t('audit.tl.receiptLink'))).toBeVisible();
    await shoot('audit', 'settled-timeline');
  });

  test('bidding war in progress', async ({ page, shoot }) => {
    await audit(page, { scenario: happy, at: HAPPY.outbid });
    await expect(page.getByRole('region', { name: t('audit.tl.title') })).toBeVisible();
    await shoot('audit', 'live-bidding');
  });

  test('filtered to bid lines', async ({ page, shoot }) => {
    await audit(page, { scenario: auditRoom, at: 9_000, query: 'type=bid' });
    await ledgerRows(page);
    await shoot('audit', 'filtered-type-bid');
  });

  test('detail sheet opened from the timeline', async ({ page, shoot }) => {
    await audit(page, { scenario: auditRoom, at: 9_000 });
    await page
      .getByRole('button', { name: new RegExp(t('audit.tl.details')) })
      .first()
      .click();
    await page.getByRole('dialog').waitFor();
    await shoot('audit', 'timeline-drawer');
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
    await ledgerRows(page);
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
