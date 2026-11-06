import { createRequire } from 'node:module';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../src/fixtures/base';
import { seedRoom, seedSession } from '../src/fixtures/room';

/**
 * axe-core over the views the web app serves on the real stack (R-QA-037, T-QA-047): zero serious
 * or critical violations in the light and projector themes, with the full result attached to the
 * report. The engine is the axe-core already installed for the web package, injected as a script.
 *
 * Covered: every route in the route table, the register form (step one and two) in a seeded room behind its stored
 * session, and the gallery with its dialog open. NOT covered: the bid, console, public screen and
 * receipt routes with a live room behind them, because a browser cannot reach those states
 * without a session for a seeded room; the web package's unit axe tests cover those states.
 */
const AXE_PATH = createRequire(import.meta.url).resolve('axe-core');

const VIEWS = [
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

// The injected engine is an inline script, which the page policy refuses.
test.use({ bypassCSP: true });

interface AxeNode {
  target: unknown[];
}
interface AxeViolation {
  id: string;
  impact: string | null;
  nodes: AxeNode[];
}
interface AxeApi {
  run: (
    context: Document,
    options: { runOnly: { type: 'tag'; values: string[] } },
  ) => Promise<{ violations: AxeViolation[] }>;
}

async function sweep(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.addScriptTag({ path: AXE_PATH });
  const all = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: AxeApi }).axe;
    const result = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.map((n) => n.target.join(' ')),
    }));
  });
  await testInfo.attach(`axe-${name}.json`, {
    body: JSON.stringify(all, null, 2),
    contentType: 'application/json',
  });
  const blocking = all
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.targets.join(', ')}`);
  expect(blocking).toEqual([]);
}

async function setTheme(page: Page, theme: string): Promise<void> {
  await page.addInitScript((value) => {
    document.documentElement.setAttribute('data-theme', value);
  }, theme);
}

for (const view of VIEWS) {
  for (const theme of THEMES) {
    test(`axe ${view} in ${theme}`, async ({ page, stack }, testInfo) => {
      await setTheme(page, theme);
      await page.goto(`${stack.webUrl}${view}`);
      await page.waitForLoadState('networkidle');
      await page.locator('main, h1').first().waitFor({ state: 'attached' });
      await sweep(page, testInfo, `${view.replace(/\W+/g, '_')}-${theme}`);
    });
  }
}

for (const theme of THEMES) {
  test(`axe register form steps one and two in ${theme}`, async ({ page, stack }, testInfo) => {
    await setTheme(page, theme);
    // A real room with a joined bidder, whose session stands in for the invite step.
    const room = await seedRoom(stack);
    await seedSession(page, room);
    await page.goto(`${stack.webUrl}/r/${room.auctionId}/register`);
    await page.locator('form').waitFor();
    await sweep(page, testInfo, `register-step1-${theme}`);
    await page.locator('input[autocomplete="nickname"]').fill('Walnut');
    await page.locator('button[type="submit"]').click();
    await page.locator('input[type="radio"]').first().waitFor();
    await page.locator('input[type="radio"]').first().check();
    await sweep(page, testInfo, `register-step2-${theme}`);
  });
}

test('axe on the gallery with the dialog open', async ({ page, stack }, testInfo) => {
  await page.goto(`${stack.webUrl}/gallery`);
  await page.getByTestId('dialog-open').click();
  await page.getByRole('dialog').waitFor();
  await sweep(page, testInfo, 'gallery-dialog');
});
