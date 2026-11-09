import { expect, test, type Page } from '@playwright/test';

/**
 * Phone baselines (issue 2314): the key routes at 360x640 and at 844x390 landscape, the sizes the
 * width-only layouts were never checked at. Each route must also fit the width (no sideways scroll).
 * Rooms run on the scripted transport, so no server is needed. Baselines come from the visual
 * workflow in CI (update_baselines), never from a developer machine.
 */

const SCREENS = [
  { name: 'join', path: '/join/room1', ready: 'main, h1' },
  { name: 'bid', path: '/r/demo/bid?scripted=1&at=3000', ready: '[data-route="bid"]' },
  { name: 'console', path: '/r/demo/console?scripted=1&at=5000', ready: '[data-route="console"]' },
  { name: 'receipt', path: '/r/room1/receipt', ready: 'main, h1' },
  { name: 'audit', path: '/r/room1/audit', ready: 'main, h1' },
  { name: 'try', path: '/try', ready: 'main, h1' },
] as const;

const VIEWPORTS = [
  { name: '360x640', width: 360, height: 640 },
  { name: '844x390', width: 844, height: 390 },
] as const;

const FROZEN_AT = new Date('2026-01-15T12:00:00.000Z');

async function settleFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all([...document.fonts].map((face) => face.load().catch(() => undefined)));
    await document.fonts.ready;
  });
}

for (const screen of SCREENS) {
  for (const viewport of VIEWPORTS) {
    test(`${screen.name} on a phone at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.clock.install({ time: FROZEN_AT });
      await page.addInitScript(() => {
        document.documentElement.setAttribute('data-theme', 'light');
      });
      await page.goto(screen.path);
      await page.locator(screen.ready).first().waitFor();
      await settleFonts(page);
      const overflow = await page.evaluate(() => {
        const root = document.scrollingElement;
        return root === null ? 0 : root.scrollWidth - window.innerWidth;
      });
      expect(overflow).toBeLessThanOrEqual(0);
      await expect(page).toHaveScreenshot(`phone-${screen.name}-${viewport.name}.png`, {
        caret: 'hide',
      });
    });
  }
}
