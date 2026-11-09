import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { t } from '../../src/copy/t';
import { TEST_IDS } from '../../src/testing/testids';

/**
 * axe-core in a real browser (R-WEB-109, T-WEB-051): zero serious, critical or moderate violations, colour
 * contrast included, on every route in the light and projector themes. The engine is injected
 * from the axe-core dev dependency, so no extra package is needed.
 */
const nodeRequire = createRequire(import.meta.url);
const AXE_PATH = nodeRequire.resolve('axe-core');

const ROUTES = [
  '/',
  '/try',
  '/demo',
  '/join/room1',
  '/r/room1/register',
  '/r/room1/bid',
  '/r/room1/receipt',
  '/r/room1/console',
  '/r/room1/screen',
  '/r/room1/audit',
  '/r/room1/hub',
  '/ops',
  '/replay/abc',
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

async function blockingViolations(page: Page): Promise<string[]> {
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
      .filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.impact === 'moderate')
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
      expect(await blockingViolations(page)).toEqual([]);
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
      expect(await blockingViolations(page)).toEqual([]);
    });
  }
}

test('axe on the gallery with the dialog open', async ({ page }) => {
  await page.goto('/gallery');
  await page.getByTestId(TEST_IDS.dialogOpen).click();
  await page.getByRole('dialog').waitFor();
  expect(await blockingViolations(page)).toEqual([]);
});

test('axe on /try with the judge dialog open', async ({ page }) => {
  await page.goto('/try');
  await page.locator('main, h1').first().waitFor({ state: 'attached' });
  await page
    .getByRole('navigation', { name: t('try.bar.label') })
    .getByRole('button', { name: new RegExp(`^${t('try.bar.join')}`) })
    .click();
  await page.getByRole('dialog').waitFor();
  expect(await blockingViolations(page)).toEqual([]);
});

/** WCAG 1.4.10 Reflow: no sideways scroll at 320 px and 390 px (R-WEB-109, issues 2090, 2101). */
for (const width of [320, 390] as const) {
  test(`/try reflows without sideways scroll at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/try');
    await page.locator('main, h1').first().waitFor({ state: 'attached' });
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      slots: [...document.querySelectorAll('.ui-otp__slot')].map((el) =>
        Math.round(el.getBoundingClientRect().right),
      ),
      chain: [...document.querySelectorAll('.ui-otp__slot')].slice(0, 1).map((el) => {
        const out: string[] = [];
        for (let n: Element | null = el; n !== null; n = n.parentElement) {
          const r = n.getBoundingClientRect();
          out.push(`${n.tagName}.${String(n.className)} l${Math.round(r.left)} w${Math.round(r.width)}`);
        }
        return out;
      }),
    }));
    expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.inner);
    for (const right of overflow.slots) {
      expect(right, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.inner);
    }
    expect(await blockingViolations(page)).toEqual([]);
  });
}
