import type { Page } from '@playwright/test';
import { t } from '../../src/copy/t';
import { auditRoom } from './support/frames';
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

/** Scrolls the grid's own scroller (whichever element AG Grid uses) to a fraction of its height. */
async function scrollGrid(page: Page, fraction: number): Promise<void> {
  await page
    .locator('.gv-gridbox')
    .first()
    .evaluate((box, f) => {
      const scroller = Array.from(box.querySelectorAll<HTMLElement>('*')).find(
        (el) =>
          el.scrollHeight > el.clientHeight + 50 &&
          /(auto|scroll)/.test(getComputedStyle(el).overflowY),
      );
      if (scroller !== undefined)
        scroller.scrollTop = scroller.scrollHeight * f - scroller.clientHeight / 2;
    }, fraction);
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
    await scrollGrid(page, 0.5);
    await page.waitForTimeout(300);
    expect(await page.locator('.gv-gridbox .ag-row').count()).toBeLessThan(150);
    await shoot('grid', 'ledger-lab-scrolled');
  });

  test('search narrows the rows', async ({ page, shoot }) => {
    await lab(page);
    await page.getByLabel(t('ledger.quick')).fill('hammer');
    await expect(page.getByText(/^30 of [\d,]+ entries$/)).toBeVisible({ timeout: 20_000 });
    await shoot('grid', 'ledger-lab-search');
  });

  test('a selected row opens its detail', async ({ page, shoot }) => {
    await lab(page);
    await page.locator('.gv-gridbox .ag-row[row-id="4"]').first().click();
    await expect(page.getByText(t('ledger.detail.hash'))).toBeVisible();
    await shoot('grid', 'ledger-lab-detail');
  });

  test('an edited entry is found and marked', async ({ page, shoot }) => {
    await lab(page);
    await page.getByRole('button', { name: /Simulate an edit to entry/ }).click();
    await expect(page.getByText(/Chain broken at entry \d+/)).toBeVisible();
    // The row is far down the ledger: search for the entry the verdict names, so it is drawn.
    const verdict = (await page.getByText(/Chain broken at entry \d+/).textContent()) ?? '';
    await page.getByLabel(t('ledger.quick')).fill(verdict.replace(/\D/g, ''));
    await expect(page.locator('.gv-grid-row--bad').first()).toBeVisible({ timeout: 20_000 });
    // The count line follows the filter, and the marked row stays drawn.
    await expect(page.getByText(/^2134 of 2134 entries$/)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('.gv-grid-row--bad').first()).toBeVisible();
    await shoot('grid', 'ledger-lab-edited');
  });

  test('holds with a totals row', async ({ page, shoot }) => {
    await lab(page);
    await page.getByRole('tab', { name: t('sim.tab.holds') }).click();
    await expect(page.getByText(t('holds.check.ok'))).toBeVisible();
    await expect(page.getByText(/^Totals for \d+ shown$/).first()).toBeVisible();
    await shoot('grid', 'holds');
  });

  test('live bids arrive as transactions', async ({ page, shoot }) => {
    await lab(page);
    await page.getByRole('tab', { name: t('sim.tab.bids') }).click();
    await page.locator('[data-testid="bids-grid"] .ag-row').first().waitFor();
    await shoot('grid', 'live-bids');
  });
});

test.describe('ledger lab: export, filters in the link, verify, memory', () => {
  test('export what you see downloads a CSV named for the room and time', async ({ page }) => {
    await lab(page);
    await page.getByLabel(t('ledger.quick')).fill('hammer');
    await expect(page.getByText(/^30 of [\d,]+ entries$/)).toBeVisible({ timeout: 20_000 });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export what you see (30 rows)' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^gavel-ledger-simulated-30d-\d{8}T\d{6}Z\.csv$/);
    const path = await file.path();
    const { readFileSync } = await import('node:fs');
    const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/);
    expect(lines).toHaveLength(31);
  });

  test('a filtered link opens the same filtered ledger', async ({ page, shoot }) => {
    const model = { type: { filterType: 'text', type: 'equals', filter: 'Hammer' } };
    await page.goto(`/ledger?gf=${encodeURIComponent(JSON.stringify(model))}`);
    await page.getByRole('heading', { level: 1, name: t('sim.title') }).waitFor();
    await expect(page.getByText(/^30 of [\d,]+ entries$/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel(t('grid.filter.type'))).toHaveValue('Hammer');
    await shoot('grid', 'ledger-lab-shared-link');
  });

  test('typing a filter writes it to the address bar', async ({ page }) => {
    await lab(page);
    await page.getByLabel(t('grid.filter.paddle')).fill('3');
    await expect.poll(() => new URL(page.url()).searchParams.get('gf')).toContain('Paddle 3');
  });

  test('verify chain marks the rows green and says what it checked', async ({ page, shoot }) => {
    await lab(page);
    await page.getByRole('button', { name: t('grid.verify.button'), exact: true }).click();
    await expect(page.getByText(/^Checked [\d,]+ entries in this export/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.gv-gridbox .gv-grid-row--ok').first()).toBeVisible();
    await expect(page.getByText(t('grid.verify.scope'))).toBeVisible();
    await shoot('grid', 'ledger-lab-verified');
  });

  test('sort and widths come back after a reload in the same tab', async ({ page }) => {
    await lab(page);
    // The grid starts saving a moment after it has settled; a person never clicks sooner.
    await page.waitForTimeout(600);
    await page.getByRole('columnheader', { name: new RegExp(t('ledger.col.amount')) }).click();
    await expect(
      page.getByRole('columnheader', { name: new RegExp(t('ledger.col.amount')) }),
    ).toHaveAttribute('aria-sort', 'ascending');
    const stored = await page.evaluate(() =>
      Object.entries(window.sessionStorage).filter(([k]) => k.startsWith('gavel.grid.columns.')),
    );
    await expect
      .poll(
        async () => {
          const raw = await page.evaluate(
            () => window.sessionStorage.getItem('gavel.grid.columns.ledger.sealed.table') ?? '[]',
          );
          const cols = JSON.parse(raw) as { colId: string; sort: string | null }[];
          return cols.find((c) => c.colId === 'amount')?.sort ?? null;
        },
        { message: `saved layout after the click: ${JSON.stringify(stored)}` },
      )
      .toBe('asc');
    const logs: string[] = [];
    page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 200)}`));
    await page.reload();
    await page.locator('.ag-row').first().waitFor();
    const after = await page.evaluate(() =>
      Object.entries(window.sessionStorage).map(([k, v]) => `${k}=${v.slice(0, 400)}`),
    );
    expect(after.join('\n'), 'saved layout survives the reload').toContain('amount');
    await page.waitForTimeout(1000);
    const sorts = await page.evaluate(() =>
      [...document.querySelectorAll('[role="columnheader"]')].map(
        (h) => `${h.getAttribute('col-id')}=${h.getAttribute('aria-sort')}`,
      ),
    );
    const now = await page.evaluate(() =>
      Object.entries(window.sessionStorage).map(([, v]) => v.slice(0, 300)),
    );
    expect(
      sorts.join(' ') + '\n' + now.join('\n') + '\n' + logs.join('\n'),
      'headers, saved layout and console after reload',
    ).toContain('amount=ascending');
  });
});

test.describe('audit page grid view', () => {
  test('the grid is the default view, the table is one switch away', async ({ page, shoot }) => {
    await openRoom(page, { role: 'reviewer', route: 'audit', scenario: auditRoom, at: 9_000 });
    await page.locator('[data-testid="ledger-grid"] .ag-row').first().waitFor();
    await expect(
      page.getByRole('button', { name: t('audit.view.grid'), exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await noSidewaysScroll(page);
    await shoot('grid', 'audit-grid-view');
    await page.getByRole('button', { name: t('audit.view.table'), exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();
  });
});

test.describe('console bid history', () => {
  test('table view', async ({ page, shoot }) => {
    await openRoom(page, {
      role: 'auctioneer',
      route: 'console',
      scenario: auditRoom,
      at: 9_000,
    });
    await page.getByRole('button', { name: t('console.hammer'), exact: true }).waitFor();
    const streamTab = page.getByRole('tab', { name: t('console.stream'), exact: true });
    if (await streamTab.isVisible()) await streamTab.click();
    await page.getByRole('button', { name: t('console.view.grid'), exact: true }).click();
    await page.locator('[data-testid="bids-grid"] .ag-row').first().waitFor();
    await shoot('grid', 'console-bid-history');
  });
});
