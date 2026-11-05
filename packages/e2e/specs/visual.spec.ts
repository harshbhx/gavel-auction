import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../src/fixtures/base';

const BASELINES = fileURLToPath(new URL('../__screenshots__', import.meta.url));
const updating = (process.env['UPDATE'] ?? '') !== '';

/**
 * Visual baselines (R-QA-034, T-QA-046) at 1280x720 and 390x844, pixel ratio under 0.002 (set in
 * the config). Baselines are written in CI only and change only in a PR labelled visual-update.
 * Covered so far: landing and the component gallery. The public screen, ladder and settlement
 * need a seeded room and are not covered yet.
 */

const VIEWPORTS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '390x844', width: 390, height: 844 },
] as const;

const SCREENS = [
  { name: 'landing', path: '/' },
  { name: 'gallery', path: '/gallery' },
] as const;

for (const screen of SCREENS) {
  for (const viewport of VIEWPORTS) {
    test(`${screen.name} at ${viewport.name}`, async ({ page, stack }, testInfo) => {
      test.skip(
        !updating && !existsSync(`${BASELINES}/${testInfo.project.name}`),
        'no baselines committed for this project yet',
      );
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.clock.install({ time: new Date('2026-01-15T12:00:00.000Z') });
      await page.goto(`${stack.webUrl}${screen.path}`);
      await expect(page).toHaveScreenshot(`${screen.name}-${viewport.name}.png`);
    });
  }
}
