import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { TEST_IDS } from '../../src/testing/testids';

/**
 * axe-core in a real browser (R-WEB-109, T-WEB-051): zero serious or critical violations, colour
 * contrast included, on every route in the light and projector themes. The engine is injected
 * from the axe-core dev dependency, so no extra package is needed.
 */
const nodeRequire = createRequire(import.meta.url);
const AXE_PATH = nodeRequire.resolve('axe-core');

const ROUTES = [
  '/',
  '/demo',
  '/join/room1',
  '/r/room1/register',
  '/r/room1/bid',
  '/r/room1/receipt',
  '/r/room1/console',
  '/r/room1/screen',
  '/r/room1/audit',
  '/gallery',
  '/nowhere',
] as const;

const THEMES = ['light', 'projector'] as const;

interface AxeViolation {
  id: string;
  impact: string | null;
  nodes: { target: unknown[] }[];
}

interface AxeApi {
  run: (
    context: Document,
    options: { runOnly: { type: 'tag'; values: string[] } },
  ) => Promise<{ violations: AxeViolation[] }>;
}

async function seriousViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: AxeApi }).axe;
    const result = await axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
    });
    return result.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

for (const route of ROUTES) {
  for (const theme of THEMES) {
    test(`axe ${route} in ${theme}`, async ({ page }) => {
      await page.addInitScript((value) => {
        document.documentElement.setAttribute('data-theme', value);
      }, theme);
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await page.locator('main, h1').first().waitFor({ state: 'attached' });
      expect(await seriousViolations(page)).toEqual([]);
    });
  }
}

/** Live room states, driven by the scripted transport so no server is needed. */
const LIVE_STATES = [
  {
    name: 'bidder room mid auction',
    url: '/r/demo/bid?scripted=1&at=3000',
    ready: '[data-route="bid"]',
  },
  {
    name: 'auctioneer console with the ladder',
    url: '/r/demo/console?scripted=1&at=5000',
    ready: '[data-route="console"]',
  },
  { name: 'public screen', url: '/r/demo/screen?scripted=1', ready: 'main.gv-screen' },
] as const;

for (const state of LIVE_STATES) {
  for (const theme of THEMES) {
    test(`axe ${state.name} in ${theme}`, async ({ page }) => {
      await page.addInitScript((value) => {
        document.documentElement.setAttribute('data-theme', value);
      }, theme);
      await page.goto(state.url);
      await page.locator(state.ready).waitFor();
      expect(await seriousViolations(page)).toEqual([]);
    });
  }
}

test('axe on the gallery with the dialog open', async ({ page }) => {
  await page.goto('/gallery');
  await page.getByTestId(TEST_IDS.dialogOpen).click();
  await page.getByRole('dialog').waitFor();
  expect(await seriousViolations(page)).toEqual([]);
});
