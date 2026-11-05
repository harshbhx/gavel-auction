import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Responsive audit (R-WEB-115, R-WEB-117, R-WEB-118, T-WEB-055): bidder routes reflow at 320 px
 * and at a 200 percent zoom (a 640 px wide viewport on a 1280 px window), the public screen fits
 * 1920x1080 and 1280x720 without vertical scroll, and the quick-bid bar pads for the safe area.
 */

const BIDDER_ROUTES = [
  '/',
  '/join/room1',
  '/r/room1/register',
  '/r/room1/bid',
  '/r/room1/receipt',
  '/gallery',
] as const;

const NARROW = [
  { name: '320 px', width: 320, height: 640 },
  { name: '200 percent zoom', width: 640, height: 450 },
] as const;

for (const size of NARROW) {
  for (const route of BIDDER_ROUTES) {
    test(`no horizontal scroll at ${size.name} on ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => {
        const root = document.scrollingElement;
        return root === null ? 0 : root.scrollWidth - window.innerWidth;
      });
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}

const PROJECTORS = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
] as const;

for (const size of PROJECTORS) {
  test(`public screen has no vertical scroll at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/r/room1/screen');
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement;
      return root === null ? 0 : root.scrollHeight - window.innerHeight;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('the quick-bid bar pads for the bottom safe area', () => {
  const source = readFileSync(
    new URL('../../src/screens/bid/BidScreen.tsx', import.meta.url),
    'utf8',
  );
  expect(source).toContain('env(safe-area-inset-bottom)');
});
