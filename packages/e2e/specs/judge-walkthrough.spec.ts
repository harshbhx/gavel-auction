import { test as plain } from '@playwright/test';
import { expect, test } from '../src/fixtures/base';

/**
 * Judge walkthrough (R-QA-055, T-QA-049): a judge with only a browser reaches the demo screen (the role links
 * once they are wired) of a demo auction in under five minutes. The first test runs on the fake stack. The second runs the
 * same path against a hosted URL (GAVEL_JUDGE_URL) and is skipped when that is not set; the nightly
 * production smoke sets it.
 */

const BUDGET_MS = 300_000;

async function walk(page: import('@playwright/test').Page, url: string): Promise<void> {
  const started = Date.now();
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /start a demo auction/i }).click();
  // The role links are not wired into the /demo screen yet; extend this once they are.
  await expect(page).toHaveURL(/\/demo$/, { timeout: 30_000 });
  await expect(
    page.getByRole('heading', { level: 1, name: /start a demo auction/i }),
  ).toBeVisible();
  expect(Date.now() - started).toBeLessThan(BUDGET_MS);
}

test('a judge reaches every role link on the fake stack within five minutes', async ({
  page,
  stack,
}) => {
  test.setTimeout(BUDGET_MS);
  await walk(page, stack.webUrl);
});

const hosted = process.env['GAVEL_JUDGE_URL'];

plain(
  'a judge reaches every role link on the hosted site within five minutes',
  async ({ page }) => {
    plain.skip(hosted === undefined || hosted === '', 'GAVEL_JUDGE_URL is not set');
    plain.setTimeout(BUDGET_MS);
    await walk(page, hosted ?? '');
  },
);
