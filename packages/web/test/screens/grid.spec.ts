import type { Page } from '@playwright/test';
import { t } from '../../src/copy/t';
import { HAPPY, auditRoom, happy } from './support/frames';
import { expect, openRoom, test } from './support/harness';

/**
 * The AG Grid tables: the ledger lab (a 30-day simulated run with thousands of sealed entries), the
 * audit page's grid view and the console's bid history table. The specs also check what a picture
 * cannot show: that rows are virtualised, that the tampered row is marked, and that a phone gets
 * cards with no sideways scroll.
 */

async function lab(page: Page): Promise<void> {
  await page.goto('/ledger');
  await page.getByRole('heading', { level: 1, name: t('sim.title') }).waitFor();
  await page.locator('.ag-row').first().waitFor();
  await expect(page.getByText(/Chain intact: [\d,]+ entries sealed and linked/)).toBeVisible();
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

test.describe('ledger lab', () => {
  test('ledger, intact chain', async ({ page, shoot }) => {
    await lab(page);
    await noSidewaysScroll(page);
    await shoot('grid', 'ledger-lab');
  });

  test('draws only the visible rows of thousands', async ({ page }) => {
    await lab(page);
    const drawn = await page.locator('.gv-gridbox .ag-row').count();
    expect(drawn).toBeGreaterThan(5);
    expect(drawn).toBeLessThan(150);
    const shown = await page
      .getByText(/^[\d,]+ of [\d,]+ entries$/)
      .first()
      .textContent();
    expect(Number((shown ?? '').split(' of ')[1]?.replace(/\D/g, ''))).toBeGreaterThan(1500);
  });

  test('scrolls far down without drawing every row', async ({ page, shoot }) => {
    await lab(page);
    await page.locator('.gv-gridbox .ag-body-viewport').evaluate((el) => {
      el.scrollTop = el.scrollHeight / 2;
    });
    await page.waitForTimeout(300);
    expect(await page.locator('.gv-gridbox .ag-row').count()).toBeLessThan(150);
    await shoot('grid', 'ledger-lab-scrolled');
  });

  test('search narrows the rows', async ({ page, shoot }) => {
    await lab(page);
    await page.getByLabel(t('ledger.quick')).fill('hammer');
    await expect(page.getByText(/^30 of [\d,]+ entries$/)).toBeVisible();
    await shoot('grid', 'ledger-lab-search');
  });

  test('a selected row opens its detail', async ({ page, shoot }) => {
    await lab(page);
    await page.locator('.gv-gridbox .ag-center-cols-container .ag-row').nth(3).click();
    await expect(page.getByText(t('ledger.detail.hash'))).toBeVisible();
    await shoot('grid', 'ledger-lab-detail');
  });

  test('an edited entry is found and marked', async ({ page, shoot }) => {
    await lab(page);
    await page.getByRole('button', { name: /Simulate an edit to entry/ }).click();
    await expect(page.getByText(/Chain broken at entry \d+/)).toBeVisible();
    // The row is far down the ledger, so it is only drawn once the grid scrolls to it.
    await page.locator('.gv-gridbox .ag-body-viewport').evaluate((el) => {
      el.scrollTop = el.scrollHeight * 0.55 - el.clientHeight / 2;
    });
    await expect(page.locator('.gv-grid-row--bad').first()).toBeAttached();
    await shoot('grid', 'ledger-lab-edited');
  });

  test('holds with a totals row', async ({ page, shoot }) => {
    await lab(page);
    await page.getByRole('tab', { name: t('sim.tab.holds') }).click();
    await expect(page.getByText(t('holds.check.ok'))).toBeVisible();
    await page.locator('.ag-floating-bottom .ag-row').first().waitFor();
    await shoot('grid', 'holds');
  });

  test('live bids arrive as transactions', async ({ page, shoot }) => {
    await lab(page);
    await page.getByRole('tab', { name: t('sim.tab.bids') }).click();
    await page.locator('[data-testid="bids-grid"] .ag-row').first().waitFor();
    await shoot('grid', 'live-bids');
  });
});

test.describe('audit page grid view', () => {
  test('table switched to the grid', async ({ page, shoot }) => {
    await openRoom(page, { role: 'reviewer', route: 'audit', scenario: auditRoom, at: 9_000 });
    await page.getByRole('button', { name: t('audit.view.grid'), exact: true }).click();
    await page.locator('[data-testid="ledger-grid"] .ag-row').first().waitFor();
    await noSidewaysScroll(page);
    await shoot('grid', 'audit-grid-view');
  });
});

test.describe('console bid history', () => {
  test('table view', async ({ page, shoot }) => {
    await openRoom(page, {
      role: 'auctioneer',
      route: 'console',
      scenario: happy,
      at: HAPPY.outbid,
    });
    await page.getByRole('button', { name: t('console.hammer'), exact: true }).waitFor();
    await page.getByRole('button', { name: t('console.view.grid'), exact: true }).click();
    await page.locator('[data-testid="bids-grid"] .ag-row').first().waitFor();
    await shoot('grid', 'console-bid-history');
  });
});
