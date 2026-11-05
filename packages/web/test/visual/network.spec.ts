import { expect, test } from '@playwright/test';

/**
 * Network audit (R-WEB-003, R-WEB-004, T-WEB-058): every request made while the app loads goes to
 * the app itself or the room host, and the page ships a CSP with no inline script allowance.
 * The PayPal origin is only allowed on the approval step, which these pages never reach.
 */

const ROOM_HOST = 'localhost:8787';

const ROUTES = ['/', '/gallery', '/nowhere'] as const;

for (const route of ROUTES) {
  test(`only own origins are contacted on ${route}`, async ({ page, baseURL }) => {
    const own = new URL(baseURL ?? 'http://127.0.0.1:4173').host;
    const hosts = new Set<string>();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol === 'data:' || url.protocol === 'blob:') return;
      hosts.add(url.host);
    });
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    for (const host of hosts) {
      expect([own, ROOM_HOST]).toContain(host);
    }
  });
}

test('a CSP is present and script-src allows no inline code', async ({ page }) => {
  await page.goto('/');
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).not.toBeNull();
  const script = (policy ?? '').split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
  expect(script).not.toBe('');
  expect(script).not.toContain('unsafe-inline');
  expect(script).not.toContain('unsafe-eval');
});
