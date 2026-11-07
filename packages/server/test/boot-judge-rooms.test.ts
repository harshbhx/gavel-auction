import type { FakePayPalServer } from '@gavel/payments/fake';
import { ApproveHoldResponse, CreateHoldResponse } from '@gavel/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeServer, type Composed } from '../src/boot/compose';

// The composition starts its own fake PayPal; keep a handle so the test can play the buyer.
const fakes = vi.hoisted(() => [] as FakePayPalServer[]);
vi.mock('@gavel/payments/fake', async (importActual) => {
  const actual = await importActual<typeof import('@gavel/payments/fake')>();
  class RecordedFake extends actual.FakePayPalServer {
    constructor(...args: ConstructorParameters<typeof actual.FakePayPalServer>) {
      super(...args);
      fakes.push(this);
    }
  }
  return { ...actual, FakePayPalServer: RecordedFake };
});

const KEY = 'test-admin-key-test-admin-key';
const base = {
  PUBLIC_URL: 'http://localhost:8080',
  TOKEN_SECRET: 'test-secret-test-secret-test-secret-0123',
  ADMIN_KEY: KEY,
  PAYMENTS: 'fake',
  LOG_LEVEL: 'error',
};

const running: Composed[] = [];
afterEach(async () => {
  for (const app of running.splice(0)) await app.close();
  fakes.splice(0);
});

async function boot(
  extra: Record<string, string>,
): Promise<{ url: string; paypal?: FakePayPalServer }> {
  const app = await composeServer({ ...base, ...extra }, { sink: () => undefined });
  running.push(app);
  const url = `http://127.0.0.1:${String(await app.listen(0))}`;
  const paypal = fakes.at(-1);
  return paypal === undefined ? { url } : { url, paypal };
}

const json = { 'content-type': 'application/json' };
const tokenOf = (link: string): string => new URL(link).hash.replace(/^#token=/, '');

describe('judge rooms: boot validation', () => {
  it('is off by default: create answers 404 and the probe says false', async () => {
    const { url } = await boot({});
    expect((await fetch(`${url}/api/judge/rooms`, { method: 'POST' })).status).toBe(404);
    const probe = await fetch(`${url}/api/judge/capabilities`);
    expect(await probe.json()).toEqual({ judgeRooms: false, accepting: false });
  });

  it('refuses the flag on a production-like host without sandbox PayPal', async () => {
    await expect(
      boot({
        JUDGE_ROOMS: 'true',
        PUBLIC_URL: 'https://gavel.example.com',
        NODE_ENV: 'production',
      }),
    ).rejects.toBeDefined();
  });

  it('keeps the demo flag refused in production even with judge rooms on', async () => {
    await expect(
      boot({
        JUDGE_ROOMS: 'true',
        DEMO_MODE: '1',
        PUBLIC_URL: 'https://gavel.example.com',
        NODE_ENV: 'production',
      }),
    ).rejects.toBeDefined();
  });
});

describe('judge rooms: scenario on the fake PayPal', () => {
  it('runs a room end to end: create, invite, join, hold, hammer, no admin reach', async () => {
    const { url, paypal } = await boot({ JUDGE_ROOMS: 'true' });
    if (paypal === undefined) throw new Error('the composition started no fake PayPal');
    const made = await fetch(`${url}/api/judge/rooms`, {
      method: 'POST',
      headers: json,
      body: '{}',
    });
    expect(made.status).toBe(201);
    const room = (await made.json()) as { auctionId: string; auctioneerToken: string };
    const auth = { ...json, authorization: `Bearer ${room.auctioneerToken}` };

    // The room token cannot reach operator routes.
    for (const path of ['/ops/rooms', '/api/judge/pause']) {
      const res = await fetch(`${url}${path}`, {
        method: path.startsWith('/ops') ? 'GET' : 'POST',
        headers: auth,
        ...(path.startsWith('/ops') ? {} : { body: JSON.stringify({ paused: true }) }),
      });
      expect(res.status).toBe(401);
    }

    const minted = await fetch(`${url}/api/auctions/${room.auctionId}/invites`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ count: 1 }),
    });
    expect(minted.status).toBe(201);
    const [invite] = ((await minted.json()) as { invites: Array<{ link: string }> }).invites;
    if (invite === undefined) throw new Error('one invite expected');
    const joined = await fetch(`${url}/api/auctions/${room.auctionId}/join`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ invite: tokenOf(invite.link) }),
    });
    expect(joined.status).toBe(200);
    const { sessionToken } = (await joined.json()) as { sessionToken: string };
    const bidder = { ...json, authorization: `Bearer ${sessionToken}` };

    // An off-grid ceiling is refused; a preset one is held.
    const odd = await fetch(`${url}/api/holds`, {
      method: 'POST',
      headers: bidder,
      body: JSON.stringify({ auctionId: room.auctionId, ceilingCents: 12345 }),
    });
    expect(odd.status).toBe(400);
    const hold = await fetch(`${url}/api/holds`, {
      method: 'POST',
      headers: bidder,
      body: JSON.stringify({ auctionId: room.auctionId, ceilingCents: 2000 }),
    });
    expect(hold.status).toBe(201);
    const order = CreateHoldResponse.parse(await hold.json());
    paypal.core.approveOrder(order.orderId);
    const approved = await fetch(`${url}/api/holds/${encodeURIComponent(order.holdId)}/approve`, {
      method: 'POST',
      headers: bidder,
      body: JSON.stringify({ orderId: order.orderId, name: 'Judge' }),
    });
    expect(approved.status).toBe(200);
    expect(ApproveHoldResponse.parse(await approved.json()).status).toBe('HELD');

    // The creator ends the lot with the room token.
    const stop = await fetch(`${url}/api/auctions/${room.auctionId}/kill`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ confirm: 'STOP' }),
    });
    expect(stop.status).toBe(200);
  });
});
