import { createRequire } from 'node:module';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../src/fixtures/base';
import { putRoomInState, seedRoom, storeBidderSession } from '../src/fixtures/room';

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
      // 'load', not 'networkidle': a page with an open room socket is never idle.
      await page.waitForLoadState('load');
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
    // Stored from a loaded page of the same origin: with the CSP bypass on, WebKit does not run
    // the init script that the keyboard spec uses before the app reads the session.
    await page.goto(`${stack.webUrl}/gallery`);
    await page.evaluate(
      ({ id, token, bidderId }) => {
        sessionStorage.setItem(`gavel:session:${id}:bidder`, JSON.stringify({ token, bidderId }));
      },
      { id: room.auctionId, token: room.token, bidderId: room.bidderId },
    );
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

/**
 * Bid, console, public screen and receipt on the scripted scenarios, reached with `?scripted=1`
 * (`at` holds the scenario at one moment).
 */
const SCRIPTED_VIEWS = [
  { name: 'bid-open', path: '/r/demo/bid', query: 'at=3000' },
  { name: 'bid-closed', path: '/r/demo/bid', query: 'scenario=kill_switch&at=5500' },
  { name: 'console', path: '/r/demo/console', query: 'at=5000' },
  { name: 'screen-live', path: '/r/demo/screen', query: 'at=5000' },
  { name: 'screen-sold', path: '/r/demo/screen', query: 'at=16000' },
  { name: 'receipt-held', path: '/r/demo/receipt', query: 'at=16500' },
  { name: 'receipt-settled', path: '/r/demo/receipt', query: 'at=18500' },
] as const;

for (const view of SCRIPTED_VIEWS) {
  for (const theme of THEMES) {
    test(`axe scripted ${view.name} in ${theme}`, async ({ page, stack }, testInfo) => {
      await setTheme(page, theme);
      await page.goto(`${stack.webUrl}${view.path}?scripted=1&${view.query}`);
      await page.locator('[data-provenance="scripted"]').waitFor();
      await page.locator('main, [data-route]').first().waitFor({ state: 'attached' });
      await sweep(page, testInfo, `scripted-${view.name}-${theme}`);
    });
  }
}

/**
 * Bid paused, bid stopped and the audit view, on a real seeded room whose state is set through the
 * server's own control route (no scripted scenario is needed): `paused` pauses the open lot,
 * `stopped` hammers it with closeNow, which sets the stopped flag the bid screen reads. The audit
 * view opens with the room's auctioneer link in the URL fragment, which is a link that opens it
 * (a reviewer link opens the same view).
 */
const ROOM_STATE_VIEWS = [
  { name: 'bid-paused', state: 'paused', banner: 'Paused by the auctioneer' },
  { name: 'bid-stopped', state: 'stopped', banner: 'Auction stopped' },
] as const;

for (const view of ROOM_STATE_VIEWS) {
  for (const theme of THEMES) {
    test(`axe ${view.name} in ${theme}`, async ({ page, stack }, testInfo) => {
      await setTheme(page, theme);
      const room = await seedRoom(stack);
      await putRoomInState(stack, room, view.state);
      await storeBidderSession(page, stack, room);
      await page.goto(`${stack.webUrl}/r/${room.auctionId}/bid`);
      await expect(page.getByText(view.banner).first()).toBeVisible({ timeout: 20_000 });
      await sweep(page, testInfo, `${view.name}-${theme}`);
    });
  }
}

for (const theme of THEMES) {
  test(`axe audit view with a reviewer-style link in ${theme}`, async ({
    page,
    stack,
  }, testInfo) => {
    await setTheme(page, theme);
    const room = await seedRoom(stack);
    await putRoomInState(stack, room, 'stopped');
    await page.goto(`${stack.webUrl}/r/${room.auctionId}/audit#token=${room.auctioneerToken}`);
    await page.locator('main[data-route="audit"]').waitFor();
    // Past the loading state: the guide shows both with and without trail rows.
    await page.locator('#gv-audit-guide-title').waitFor({ timeout: 20_000 });
    await sweep(page, testInfo, `audit-${theme}`);
  });
}
