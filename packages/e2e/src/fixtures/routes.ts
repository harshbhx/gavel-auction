import type { Page } from '@playwright/test';
import type { BrowserStack } from './base';
import { putRoomInState, seedRoom, storeBidderSession } from './room';

/**
 * Every route and state the emulation specs (200 percent zoom, forced colours) walk: the route
 * table, the scripted bid, console, screen and receipt moments, and real seeded-room states (the
 * register steps, bid paused and stopped, the console, the public screen and the audit view).
 * `open` leaves the page on the state and waits until it has rendered.
 */
export interface RouteCase {
  name: string;
  open(page: Page, stack: BrowserStack): Promise<void>;
}

const STATIC_PATHS = [
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
  '/gallery',
  '/nowhere',
] as const;

const SCRIPTED = [
  { name: 'bid-open', path: '/r/demo/bid', query: 'at=3000' },
  { name: 'bid-closed', path: '/r/demo/bid', query: 'scenario=kill_switch&at=5500' },
  { name: 'console', path: '/r/demo/console', query: 'at=5000' },
  { name: 'screen-live', path: '/r/demo/screen', query: 'at=5000' },
  { name: 'screen-sold', path: '/r/demo/screen', query: 'at=16000' },
  { name: 'receipt-held', path: '/r/demo/receipt', query: 'at=16500' },
  { name: 'receipt-settled', path: '/r/demo/receipt', query: 'at=18500' },
] as const;

async function rendered(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.locator('main, h1, [data-route]').first().waitFor({ state: 'attached' });
}

export const ROUTE_CASES: RouteCase[] = [
  ...STATIC_PATHS.map(
    (path): RouteCase => ({
      name: `route ${path}`,
      open: async (page, stack) => {
        await page.goto(`${stack.webUrl}${path}`);
        await rendered(page);
      },
    }),
  ),
  ...SCRIPTED.map(
    (v): RouteCase => ({
      name: `scripted ${v.name}`,
      open: async (page, stack) => {
        await page.goto(`${stack.webUrl}${v.path}?scripted=1&${v.query}`);
        await page.locator('[data-provenance="scripted"]').waitFor();
        await rendered(page);
      },
    }),
  ),
  {
    name: 'room register step one',
    open: async (page, stack) => {
      const room = await seedRoom(stack);
      await storeBidderSession(page, stack, room);
      await page.goto(`${stack.webUrl}/r/${room.auctionId}/register`);
      await page.locator('form').waitFor();
    },
  },
  {
    name: 'room register step two',
    open: async (page, stack) => {
      const room = await seedRoom(stack);
      await storeBidderSession(page, stack, room);
      await page.goto(`${stack.webUrl}/r/${room.auctionId}/register`);
      await page.locator('input[autocomplete="nickname"]').fill('Walnut');
      await page.locator('button[type="submit"]').click();
      await page.locator('input[type="radio"]').first().waitFor();
      await page.locator('input[type="radio"]').first().check({ force: true });
    },
  },
  {
    name: 'room bid paused',
    open: async (page, stack) => {
      const room = await seedRoom(stack);
      await putRoomInState(stack, room, 'paused');
      await storeBidderSession(page, stack, room);
      await page.goto(`${stack.webUrl}/r/${room.auctionId}/bid`);
      await page.getByText('Paused by the auctioneer').first().waitFor({ timeout: 20_000 });
    },
  },
  {
    name: 'room bid stopped',
    open: async (page, stack) => {
      const room = await seedRoom(stack);
      await putRoomInState(stack, room, 'stopped');
      await storeBidderSession(page, stack, room);
      await page.goto(`${stack.webUrl}/r/${room.auctionId}/bid`);
      await page.getByText('Auction stopped').first().waitFor({ timeout: 20_000 });
    },
  },
  {
    name: 'room console',
    open: async (page, stack) => {
      const room = await seedRoom(stack);
      await page.goto(`${stack.webUrl}/r/${room.auctionId}/console#token=${room.auctioneerToken}`);
      await page.locator('[data-route="console"]').waitFor();
    },
  },
  {
    name: 'room public screen',
    open: async (page, stack) => {
      const room = await seedRoom(stack);
      await page.goto(`${stack.webUrl}/r/${room.auctionId}/screen#token=${room.auctioneerToken}`);
      await page.locator('main.gv-screen').waitFor();
    },
  },
  {
    name: 'room audit view',
    open: async (page, stack) => {
      const room = await seedRoom(stack);
      await putRoomInState(stack, room, 'stopped');
      await page.goto(`${stack.webUrl}/r/${room.auctionId}/audit#token=${room.auctioneerToken}`);
      await page.locator('#gv-audit-guide-title').waitFor({ timeout: 20_000 });
    },
  },
];
