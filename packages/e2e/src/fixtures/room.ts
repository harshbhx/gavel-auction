import type { Page } from '@playwright/test';
import type { BrowserStack } from './base';

/**
 * A real room with one joined bidder, made through the server's own HTTP routes, so the register
 * route has a snapshot to render a form from. The web app keeps the bidder session in
 * sessionStorage under `gavel:session:<room>:bidder`; seeding it stands in for the invite step.
 */
export interface SeededRoom {
  readonly auctionId: string;
  readonly token: string;
  readonly bidderId: string;
  /** Auctioneer token from the room's own link, for the console, the screen and control calls. */
  readonly auctioneerToken: string;
}

async function ok<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function seedRoom(stack: BrowserStack): Promise<SeededRoom> {
  const created = await ok<{ auctionId: string; auctioneerLink: string }>(
    await fetch(`${stack.serverUrl}/api/auctions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': stack.adminKey },
      body: JSON.stringify({
        title: 'a11y room',
        config: {
          mode: 'english',
          currency: 'USD',
          reserve: 10000,
          minIncrement: 1000,
          endTs: Date.now() + 600_000,
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
  const auctioneerToken = created.auctioneerLink.split('#token=')[1] ?? '';
  const { invites } = await ok<{ invites: Array<{ link: string }> }>(
    await fetch(`${stack.serverUrl}/api/auctions/${created.auctionId}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${auctioneerToken}` },
      body: JSON.stringify({ count: 1 }),
    }),
    'mint invite',
  );
  const invite = invites[0];
  if (invite === undefined) throw new Error('the server minted no invite');
  const joined = await ok<{ sessionToken: string; bidderId: string }>(
    await fetch(`${stack.serverUrl}/api/auctions/${created.auctionId}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invite: invite.link.split('#token=')[1] ?? '' }),
    }),
    'join room',
  );
  return {
    auctionId: created.auctionId,
    token: joined.sessionToken,
    bidderId: joined.bidderId,
    auctioneerToken,
  };
}

/** Hammers the lot with no bids, through the server's own control route: the room ends unsold. */
export async function hammerRoom(stack: BrowserStack, room: SeededRoom): Promise<void> {
  await ok<{ ok: boolean }>(
    await fetch(`${stack.serverUrl}/api/auctions/${room.auctionId}/control`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${room.auctioneerToken}`,
      },
      body: JSON.stringify({ controlId: 'hammer-1', action: 'hammer', args: { closeNow: 1 } }),
    }),
    'hammer room',
  );
}

/** Stores the bidder session before any page script runs, for every page the test opens. */
export async function seedSession(page: Page, room: SeededRoom): Promise<void> {
  await page.addInitScript(
    ({ id, token, bidderId }) => {
      sessionStorage.setItem(`gavel:session:${id}:bidder`, JSON.stringify({ token, bidderId }));
    },
    { id: room.auctionId, token: room.token, bidderId: room.bidderId },
  );
}

/**
 * One auctioneer control call on a seeded room (open, pause, resume, hammer). Returns the HTTP
 * status and never throws, so a caller can tolerate "already open" and still assert the call it
 * needs.
 */
export async function controlRoom(
  stack: BrowserStack,
  room: SeededRoom,
  action: 'open' | 'pause' | 'resume' | 'hammer',
  args?: Record<string, number>,
): Promise<number> {
  const res = await fetch(`${stack.serverUrl}/api/auctions/${room.auctionId}/control`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${room.auctioneerToken}`,
    },
    body: JSON.stringify({
      controlId: `${action}-${Date.now()}`,
      action,
      ...(args === undefined ? {} : { args }),
    }),
  });
  await res.arrayBuffer();
  return res.status;
}

/**
 * Stores the bidder session from a loaded page of the same origin. With the CSP bypass on, WebKit
 * does not run an init script before the app reads the session, so a stored value is the safe way.
 */
export async function storeBidderSession(
  page: Page,
  stack: BrowserStack,
  room: SeededRoom,
): Promise<void> {
  await page.goto(`${stack.webUrl}/gallery`);
  await page.evaluate(
    ({ id, token, bidderId }) => {
      sessionStorage.setItem(`gavel:session:${id}:bidder`, JSON.stringify({ token, bidderId }));
    },
    { id: room.auctionId, token: room.token, bidderId: room.bidderId },
  );
}

/** A seeded room in one of the states the bid screen and the audit view show. */
export type RoomState = 'open' | 'paused' | 'stopped';

/**
 * Puts a seeded room in `state` through the server's own control route: `paused` pauses the open
 * lot, `stopped` hammers it with closeNow, which sets the stopped flag on the snapshot.
 */
export async function putRoomInState(
  stack: BrowserStack,
  room: SeededRoom,
  state: RoomState,
): Promise<void> {
  // A seeded room may already be open; any other answer to open is caught by the next call.
  await controlRoom(stack, room, 'open');
  if (state === 'paused') {
    const status = await controlRoom(stack, room, 'pause');
    if (status !== 200) throw new Error(`pause answered ${status}`);
  } else if (state === 'stopped') {
    await hammerRoom(stack, room);
  }
}
