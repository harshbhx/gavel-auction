import { expect, test, type Page } from '@playwright/test';

/**
 * Visual regression matrix (R-WEB-124, T-WEB-056): screens x viewports x themes. The clock is
 * frozen, animations are off, and the screenshot tolerance is the 0.002 set in the config.
 * Baselines are produced by the visual workflow in CI, never on a developer machine.
 */

const SCREENS = [
  { name: 'landing', path: '/' },
  { name: 'gallery', path: '/gallery' },
  { name: 'not-found', path: '/nowhere' },
] as const;

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
] as const;

const THEMES = ['light', 'projector'] as const;

const FROZEN_AT = new Date('2026-01-15T12:00:00.000Z');

async function prepare(page: Page, theme: string): Promise<void> {
  await page.clock.install({ time: FROZEN_AT });
  await page.addInitScript((value) => {
    document.documentElement.setAttribute('data-theme', value);
  }, theme);
}

/**
 * Waits until every declared web font face has loaded. `document.fonts.ready` alone can resolve
 * before a lazily rendered route has asked for its faces, and the later swap (font-display: swap)
 * reflows text, which showed up as a few percent of pixels moving at 768 wide on some runs.
 * Loading the declared faces by hand removes the dependence on when the page first lays text out.
 */
async function settleFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all([...document.fonts].map((face) => face.load().catch(() => undefined)));
    await document.fonts.ready;
  });
}

for (const screen of SCREENS) {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${screen.name} at ${viewport.name} in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await prepare(page, theme);
        await page.goto(screen.path);
        await settleFonts(page);
        await expect(page).toHaveScreenshot(`${screen.name}-${viewport.name}-${theme}.png`, {
          caret: 'hide',
        });
      });
    }
  }
}
