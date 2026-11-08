import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, type Locator, type Page } from '@playwright/test';
import type { BidderId, Cents } from '@gavel/shared';
import type { Scenario } from '../../../src/net/transport';
import type { ClientMessage, ServerMessage } from '../../../src/wire';

/** Where the PNGs land. The index script and the workflow read the same folder. */
export const OUT_DIR = process.env['UI_SCREENS_DIR'] ?? join(process.cwd(), 'ui-screens-out');

export const API = 'http://localhost:8787';
const WS_URL = /^ws:\/\/localhost:8787\/ws/;

/** Epoch ms that the scenario clock starts at (src/testing/builders.ts). */
export const BASE_TIME = 1_700_000_000_000;

/** A time for pages that do not show a room: fixed, so no screenshot depends on the day it runs. */
export const FROZEN_AT = new Date('2026-01-15T12:00:00.000Z');

interface Fixtures {
  /** Saves the page as screens/<view>--<state>--<project>.png. */
  shoot: (view: string, state: string) => Promise<void>;
}

export const test = base.extend<Fixtures>({
  page: async ({ page }, provide, testInfo) => {
    const theme = String(testInfo.project.metadata['theme'] ?? 'light');
    await page.addInitScript((value) => {
      document.documentElement.setAttribute('data-theme', value);
    }, theme);
    await page.clock.setFixedTime(FROZEN_AT);
    await provide(page);
  },
  shoot: async ({ page }, provide, testInfo) => {
    // A project may list the views it captures (metadata.views); other views are not saved.
    const views = testInfo.project.metadata['views'] as readonly string[] | undefined;
    await provide(async (view, state) => {
      if (views !== undefined && !views.includes(view)) return;
      mkdirSync(OUT_DIR, { recursive: true });
      await page.evaluate(() => document.fonts.ready);
      // Lets effects, lazy chunks and one render pass settle before the picture is taken.
      await page.waitForTimeout(350);
      await page.screenshot({
        path: join(OUT_DIR, `${view}--${state}--${testInfo.project.name}.png`),
        fullPage: true,
      });
    });
  },
});

export { expect } from '@playwright/test';

/* ------------------------------------------------------------------ rooms over a mock socket */

export type RoomRole = 'bidder' | 'auctioneer' | 'screen' | 'reviewer';

export interface Envelope {
  seq: number;
  ts: number;
}

export interface RoomOptions {
  scenario: Scenario;
  /** Scenario time in ms: every frame at or before it is delivered on join. */
  at: number;
  role: RoomRole;
  /** Route after /r/<room>/ , such as bid, console, screen, receipt or audit. */
  route: 'bid' | 'console' | 'screen' | 'receipt' | 'audit';
  /** Query string for the route, without the question mark. */
  query?: string;
  /** Frames to send back for something the page sent (a bid, a confirm answer). */
  reply?: (msg: ClientMessage, next: () => Envelope) => ServerMessage[];
  /** Closes the socket after the join, and refuses every later one: the page goes offline. */
  dropAfterJoin?: boolean;
  /** Answers the join with this error frame instead of any state. */
  joinError?: { code: string; message?: string; retryAfterMs?: number };
  /** Never answer the join: the route stays in its loading state. */
  silent?: boolean;
  /** Leave the token out, as a link that lost its fragment. */
  withoutToken?: boolean;
  /** Which roster paddle the device is, for the bidder role. Default: the first on the roster. */
  paddle?: number;
}

const BIDDER_CEILING_CENTS = 50_000;

function stateRoster(scenario: Scenario): ReadonlyArray<{ bidderId: string; paddle: number }> {
  for (const step of scenario.steps) {
    if (step.emit?.t === 'state') return step.emit.snapshot.roster;
  }
  return [];
}

/** The auction id the scenario's own snapshot carries; the store only accepts that room. */
export function roomIdOf(scenario: Scenario): string {
  for (const step of scenario.steps) {
    if (step.emit?.t === 'state') return step.emit.snapshot.auctionId;
  }
  throw new Error(`scenario ${scenario.name} has no state frame`);
}

function framesUpTo(scenario: Scenario, at: number, you: BidderId | null): ServerMessage[] {
  const out: ServerMessage[] = [];
  for (const step of scenario.steps) {
    if (step.emit === undefined || step.at > at) continue;
    const msg = step.emit;
    if (msg.t === 'state' && you !== null) {
      out.push({
        ...msg,
        snapshot: {
          ...msg.snapshot,
          you: { bidderId: you, ceiling: BIDDER_CEILING_CENTS as Cents },
        },
      });
    } else {
      out.push(msg);
    }
  }
  return out;
}

function lastSeqOf(frames: readonly ServerMessage[]): number {
  let last = 0;
  for (const f of frames) if ('seq' in f && typeof f.seq === 'number') last = Math.max(last, f.seq);
  return last;
}

export interface ServedRoom {
  roomId: string;
  /** The roster bidder this device stands in for, or an empty string for a screen or console. */
  bidderId: string;
}

/**
 * Answers the room socket from a scenario: the page joins as usual and is sent the frames up to
 * `at`. No real server, PayPal or network is involved.
 */
export async function serveRoom(
  page: Page,
  opts: Pick<
    RoomOptions,
    'scenario' | 'at' | 'role' | 'reply' | 'dropAfterJoin' | 'joinError' | 'silent' | 'paddle'
  >,
): Promise<ServedRoom> {
  const roomId = roomIdOf(opts.scenario);
  const roster = stateRoster(opts.scenario);
  const me =
    roster.find((r) => (opts.paddle === undefined ? true : r.paddle === opts.paddle)) ?? roster[0];
  const you = opts.role === 'bidder' && me !== undefined ? (me.bidderId as BidderId) : null;
  const frames = framesUpTo(opts.scenario, opts.at, you);
  let seq = lastSeqOf(frames);
  const next = (): Envelope => {
    seq += 1;
    return { seq, ts: BASE_TIME + opts.at + seq };
  };
  let joined = false;

  await page.clock.setFixedTime(BASE_TIME + opts.at);
  await page.routeWebSocket(WS_URL, (ws) => {
    if (opts.dropAfterJoin === true && joined) {
      void ws.close();
      return;
    }
    ws.onMessage((raw) => {
      const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) as ClientMessage;
      if (msg.t === 'join') {
        joined = true;
        if (opts.silent === true) return;
        if (opts.joinError !== undefined) {
          ws.send(
            JSON.stringify({
              v: 1,
              t: 'error',
              code: opts.joinError.code,
              message: opts.joinError.message ?? 'refused',
              ...(opts.joinError.retryAfterMs === undefined
                ? {}
                : { retryAfterMs: opts.joinError.retryAfterMs }),
            }),
          );
          return;
        }
        for (const f of frames) ws.send(JSON.stringify(f));
        if (opts.dropAfterJoin === true) setTimeout(() => void ws.close(), 400);
        return;
      }
      for (const f of opts.reply?.(msg, next) ?? []) ws.send(JSON.stringify(f));
    });
  });
  return { roomId, bidderId: me?.bidderId ?? '' };
}

/** Opens one room route against the mock socket, signed in the way that route needs. */
export async function openRoom(page: Page, opts: RoomOptions): Promise<string> {
  const served = await serveRoom(page, opts);
  if (opts.role === 'bidder' && opts.withoutToken !== true) {
    await page.addInitScript(
      ({ id, who }) => {
        sessionStorage.setItem(
          `gavel:session:${id}:bidder`,
          JSON.stringify({ token: 'bidder-token-0001', bidderId: who }),
        );
      },
      { id: served.roomId, who: served.bidderId },
    );
  }
  const needsFragment = opts.role !== 'bidder' && opts.withoutToken !== true;
  const query = opts.query === undefined ? '' : `?${opts.query}`;
  const fragment = needsFragment ? '#token=session-token-0001' : '';
  await page.goto(`/r/${served.roomId}/${opts.route}${query}${fragment}`);
  return served.roomId;
}

/* --------------------------------------------------------------------- the HTTP side, mocked */

export type ApiReply =
  | { status: number; json?: unknown }
  /** The request is never answered: the page stays in its loading state. */
  | 'hang'
  /** The request fails at the network level, as a server that is down does. */
  | 'fail';

export interface ApiRequest {
  method: string;
  path: string;
  body: string | null;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization, x-admin-key',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
};

/** Answers every request to the API origin from `answer`. */
export async function mockApi(
  page: Page,
  answer: (req: ApiRequest) => ApiReply | Promise<ApiReply>,
): Promise<void> {
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const reply = await answer({
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: request.postData(),
    });
    if (reply === 'hang') return;
    if (reply === 'fail') {
      await route.abort('connectionrefused');
      return;
    }
    await route.fulfill({
      status: reply.status,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify(reply.json ?? {}),
    });
  });
}

/** Waits until the page has drawn something besides the empty shell. */
export async function ready(page: Page): Promise<void> {
  await page.locator('main, h1').first().waitFor({ state: 'attached' });
}

/** The visible alert text of a page; the live-region announcer is an alert too, so it is skipped. */
export function alertOf(page: Page): Locator {
  return page.locator('p[role="alert"]').first();
}
