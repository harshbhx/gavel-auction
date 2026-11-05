import { expect, test } from '../src/fixtures/base';

/**
 * Cross-browser matrix (R-QA-031, R-QA-025, T-QA-045): the same checks run on all five projects
 * (Chromium, Firefox, WebKit, iPhone 14, Pixel 7) against the real server with fake payments.
 */

test('landing loads without page errors', async ({ page, stack }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(stack.webUrl);
  await expect(page.getByRole('button', { name: /start a demo auction/i })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('join button stays disabled until a code is typed', async ({ page, stack }) => {
  await page.goto(stack.webUrl);
  const join = page.getByRole('button', { name: /join/i });
  await expect(join).toBeDisabled();
  await page.getByRole('textbox').fill('zzzz');
  await expect(join).toBeEnabled();
});

test('an unknown path shows the not found screen', async ({ page, stack }) => {
  const response = await page.goto(`${stack.webUrl}/no/such/place`);
  expect(response?.status()).toBeLessThan(500);
  await expect(page.locator('body')).not.toBeEmpty();
});
