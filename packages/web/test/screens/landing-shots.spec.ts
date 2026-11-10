import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { t } from '../../src/copy/t';
import { expect, openRoom, test } from './support/harness';
import { HAPPY, happy } from './support/frames';

/**
 * The four captures on the landing Screens section (packages/web/public/landing). They are one
 * room in one state, so the story reads console, projection, bidder, receipt: lot open, paddle 12
 * leading at $350.00, then the same sale after the hammer. Desktop views come from the
 * desktop-light project (1440x900), phone views from phone-light (390x844 at 2x).
 *
 * Runs only when LANDING_SHOTS_DIR is set (the landing-shots workflow sets it), so the normal
 * screen tour does not write these files.
 */

const OUT = process.env['LANDING_SHOTS_DIR'];
/** Scenario time after the fifth bid and before the hammer: paddle 12 leads at $350.00. */
const LIVE_AT = 5_500;
const PADDLE = 12;

test.skip(OUT === undefined, 'LANDING_SHOTS_DIR is not set');

async function save(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT ?? '.', `${name}.png`), fullPage: false });
}

test.describe('landing shots', () => {
  test('console', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-light');
    await openRoom(page, { scenario: happy, at: LIVE_AT, role: 'auctioneer', route: 'console' });
    await page.getByRole('button', { name: t('console.hammer'), exact: true }).waitFor();
    await save(page, 'console');
  });

  test('screen', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-light');
    await openRoom(page, { scenario: happy, at: LIVE_AT, role: 'screen', route: 'screen' });
    await page.locator('main.gv-screen').waitFor();
    await save(page, 'screen');
  });

  test('bidder', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-light');
    await openRoom(page, {
      scenario: happy,
      at: LIVE_AT,
      role: 'bidder',
      route: 'bid',
      paddle: PADDLE,
    });
    await expect(page.getByText(t('bid.status.leading')).first()).toBeVisible();
    await save(page, 'bidder');
  });

  test('receipt', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-light');
    await openRoom(page, {
      scenario: happy,
      at: HAPPY.settled,
      role: 'bidder',
      route: 'receipt',
      paddle: PADDLE,
    });
    await expect(page.getByRole('heading', { name: t('receipt.title') })).toBeVisible();
    await save(page, 'receipt');
  });
});
