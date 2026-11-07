import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, type Page } from '@playwright/test';

/** Where the PNGs land. The index script and the workflow read the same folder. */
export const OUT_DIR = process.env['UI_SCREENS_DIR'] ?? join(process.cwd(), 'ui-screens-live-out');

/** Origin of the deployed API, from GAVEL_LIVE_API (the workflow checks it before the specs run). */
export const API = (process.env['GAVEL_LIVE_API'] ?? '').replace(/\/+$/, '');

/** Staging operator key. Optional: without it only the screens that need no room are taken. */
export const ADMIN_KEY = process.env['GAVEL_LIVE_ADMIN_KEY'] ?? '';

interface Fixtures {
  /** Saves the page as <view>--<state>--<project>.png, the same names the offline tour uses. */
  shoot: (view: string, state: string) => Promise<void>;
}

export const test = base.extend<Fixtures>({
  page: async ({ page }, provide, testInfo) => {
    const theme = String(testInfo.project.metadata['theme'] ?? 'light');
    await page.addInitScript((value) => {
      document.documentElement.setAttribute('data-theme', value);
    }, theme);
    await provide(page);
  },
  shoot: async ({ page }, provide, testInfo) => {
    await provide(async (view, state) => {
      mkdirSync(OUT_DIR, { recursive: true });
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
      await page.screenshot({
        path: join(OUT_DIR, `${view}--${state}--${testInfo.project.name}.png`),
        fullPage: true,
      });
    });
  },
});

export { expect } from '@playwright/test';

/** Lets requests and one render pass finish; a socket that never idles is not waited for. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(600);
}

export async function ready(page: Page): Promise<void> {
  await page.locator('main, h1').first().waitFor({ state: 'attached' });
}

/* ------------------------------------------------------------ rooms made through the API */

export interface LiveRoom {
  auctionId: string;
  joinCode: string;
  title: string;
  /** Token part of the console link; goes in the fragment, never in a log or a file. */
  auctioneerToken: string;
  screenToken: string;
  /** A fresh single-use invite token for the register route. */
  inviteToken: string;
}

async function call<T>(res: Response, what: string): Promise<T> {
  // The message names the step and the status only: never a body, a header or a token.
  if (!res.ok) throw new Error(`${what} failed with status ${res.status}`);
  return (await res.json()) as T;
}

function tokenOf(link: string): string {
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get('token');
  if (token === null || token === '') throw new Error('a room link carried no token');
  return token;
}

/** Creates one throwaway room through the public routes, with a fresh invite for registration. */
export async function createRoom(title: string): Promise<LiveRoom & Joined> {
  const created = await call<{
    auctionId: string;
    joinCode: string;
    auctioneerLink: string;
    screenLink: string;
  }>(
    await fetch(`${API}/api/auctions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY },
      body: JSON.stringify({
        title,
        config: {
          mode: 'english',
          currency: 'USD',
          reserve: 10000,
          minIncrement: 1000,
          endTs: Date.now() + 1_800_000,
          softCloseWindowMs: 30_000,
          softCloseExtensionMs: 30_000,
          maxExtensions: 5,
          ceilingPresets: [10000, 25000, 50000, 100000],
          confirmConfidenceThreshold: 0.85,
        },
      }),
    }),
    'create room',
  );
  const auctioneerToken = tokenOf(created.auctioneerLink);
  const { invites } = await call<{ invites: Array<{ link: string }> }>(
    await fetch(`${API}/api/auctions/${created.auctionId}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${auctioneerToken}` },
      body: JSON.stringify({ count: 2 }),
    }),
    'mint invites',
  );
  const [forRegister, forBidding] = invites;
  if (forRegister === undefined || forBidding === undefined) throw new Error('no invites minted');
  return {
    auctionId: created.auctionId,
    joinCode: created.joinCode,
    title,
    auctioneerToken,
    screenToken: tokenOf(created.screenLink),
    inviteToken: tokenOf(forRegister.link),
    ...(await joinAs(created.auctionId, tokenOf(forBidding.link))),
  };
}

export interface Joined {
  bidderToken: string;
  bidderId: string;
}

async function joinAs(auctionId: string, invite: string): Promise<Joined> {
  const joined = await call<{ sessionToken: string; bidderId: string }>(
    await fetch(`${API}/api/auctions/${auctionId}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invite }),
    }),
    'join room',
  );
  return { bidderToken: joined.sessionToken, bidderId: joined.bidderId };
}

/** Hammers the lot with no bids through the control route: the room ends unsold. */
export async function hammer(room: LiveRoom & Joined): Promise<void> {
  await call<unknown>(
    await fetch(`${API}/api/auctions/${room.auctionId}/control`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${room.auctioneerToken}`,
      },
      body: JSON.stringify({ controlId: 'hammer-live-1', action: 'hammer', args: { closeNow: 1 } }),
    }),
    'hammer room',
  );
}

/** Stores the bidder session before any page script runs, as the invite exchange would. */
export async function seedSession(page: Page, room: LiveRoom & Joined): Promise<void> {
  await page.addInitScript(
    ({ id, token, bidderId }) => {
      sessionStorage.setItem(`gavel:session:${id}:bidder`, JSON.stringify({ token, bidderId }));
    },
    { id: room.auctionId, token: room.bidderToken, bidderId: room.bidderId },
  );
}
