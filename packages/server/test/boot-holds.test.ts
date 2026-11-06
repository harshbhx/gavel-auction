import type { FakePayPalServer } from '@gavel/payments/fake';
import {
  AbandonHoldResponse,
  ApproveHoldResponse,
  CreateHoldResponse,
  HoldErrorResponse,
  HoldViewResponse,
  SystemClock,
} from '@gavel/shared';
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
const env = {
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

/** Boots exactly as main.ts does: no extraRoutes option, PAYMENTS=fake. */
async function boot(): Promise<{ url: string; paypal: FakePayPalServer }> {
  const app = await composeServer(env, { sink: () => undefined });
  running.push(app);
  const url = `http://127.0.0.1:${String(await app.listen(0))}`;
  const paypal = fakes.at(-1);
  if (paypal === undefined) throw new Error('the composition started no fake PayPal');
  return { url, paypal };
}

function auctionConfig(): Record<string, unknown> {
  return {
    mode: 'english',
    currency: 'USD',
    reserve: 10000,
    minIncrement: 500,
    endTs: new SystemClock().now() + 600_000,
    softCloseWindowMs: 30_000,
    softCloseExtensionMs: 30_000,
    maxExtensions: 5,
    ceilingPresets: [30000, 50000],
    confirmConfidenceThreshold: 0.85,
  };
}

const tokenOf = (link: string): string => new URL(link).hash.replace(/^#token=/, '');

interface Session {
  sessionToken: string;
  bidderId: string;
}

/** Creates an auction and joins two bidders through invites, as the web app does. */
async function auctionWithBidders(url: string): Promise<{
  auctionId: string;
  auctioneer: string;
  ada: Session;
  bo: Session;
}> {
  const created = await fetch(`${url}/api/auctions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-key': KEY },
    body: JSON.stringify({ title: 'Holds', config: auctionConfig() }),
  });
  expect(created.status).toBe(201);
  const { auctionId, auctioneerLink } = (await created.json()) as {
    auctionId: string;
    auctioneerLink: string;
  };
  const auctioneer = tokenOf(auctioneerLink);
  const minted = await fetch(`${url}/api/auctions/${auctionId}/invites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${auctioneer}` },
    body: JSON.stringify({ count: 2 }),
  });
  expect(minted.status).toBe(201);
  const { invites } = (await minted.json()) as { invites: Array<{ link: string }> };
  const join = async (link: string): Promise<Session> => {
    const res = await fetch(`${url}/api/auctions/${auctionId}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invite: tokenOf(link) }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as Session;
  };
  const [first, second] = invites;
  if (first === undefined || second === undefined) throw new Error('two invites expected');
  return { auctionId, auctioneer, ada: await join(first.link), bo: await join(second.link) };
}

type Method = 'GET' | 'POST' | 'DELETE';

/** One request the way the web adapters send it: JSON body on POST, session bearer token. */
function call(
  url: string,
  method: Method,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<Response> {
  return fetch(`${url}${path}`, {
    method,
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function holdError(res: Response): Promise<string> {
  return HoldErrorResponse.parse(await res.json()).error;
}

describe('hold routes in the production composition (HRD-69, issue 1074)', () => {
  it('creates, reads, approves and abandons holds for the session bidder only', async () => {
    const { url, paypal } = await boot();
    const { auctionId, ada, bo } = await auctionWithBidders(url);

    // Create: the bidder comes from the token, never from the body.
    expect(
      (await call(url, 'POST', '/api/holds', null, { auctionId, ceilingCents: 30000 })).status,
    ).toBe(401);
    const named = await call(url, 'POST', '/api/holds', ada.sessionToken, {
      auctionId,
      ceilingCents: 30000,
      bidderId: bo.bidderId,
    });
    expect(named.status).toBe(400);
    const odd = await call(url, 'POST', '/api/holds', ada.sessionToken, {
      auctionId,
      ceilingCents: 12345,
    });
    expect(odd.status).toBe(400);
    expect(await holdError(odd)).toBe('ceiling_out_of_range');
    const created = await call(url, 'POST', '/api/holds', ada.sessionToken, {
      auctionId,
      ceilingCents: 30000,
    });
    expect(created.status).toBe(201);
    const order = CreateHoldResponse.parse(await created.json());
    const holdPath = `/api/holds/${encodeURIComponent(order.holdId)}`;

    // Read: the owner sees it, another bidder gets the same answer as for an unknown id.
    const read = await call(url, 'GET', holdPath, ada.sessionToken);
    expect(read.status).toBe(200);
    expect(HoldViewResponse.parse(await read.json())).toEqual({
      holdId: order.holdId,
      status: 'PENDING_APPROVAL',
      ceilingCents: 30000,
    });
    const peek = await call(url, 'GET', holdPath, bo.sessionToken);
    expect(peek.status).toBe(404);
    expect(await holdError(peek)).toBe('order_not_found');
    expect((await call(url, 'GET', holdPath, null)).status).toBe(401);

    // Approve: refused until the buyer approved at PayPal, and only ever for the owner.
    const early = await call(url, 'POST', `${holdPath}/approve`, ada.sessionToken, {
      orderId: order.orderId,
    });
    expect(early.status).toBe(409);
    expect(await holdError(early)).toBe('order_not_approved');
    paypal.core.approveOrder(order.orderId);
    const stolen = await call(url, 'POST', `${holdPath}/approve`, bo.sessionToken, {
      orderId: order.orderId,
    });
    expect(stolen.status).toBe(404);
    const approved = await call(url, 'POST', `${holdPath}/approve`, ada.sessionToken, {
      orderId: order.orderId,
    });
    expect(approved.status).toBe(200);
    expect(ApproveHoldResponse.parse(await approved.json())).toEqual({
      holdId: order.holdId,
      status: 'HELD',
      ceilingCents: 30000,
    });
    const held = await call(url, 'GET', holdPath, ada.sessionToken);
    expect(HoldViewResponse.parse(await held.json()).status).toBe('HELD');

    // Abandon: an authorized hold is kept; an unapproved one is released, idempotently.
    const kept = await call(url, 'DELETE', holdPath, ada.sessionToken);
    expect(kept.status).toBe(409);
    expect(await holdError(kept)).toBe('hold_exists');
    const second = await call(url, 'POST', '/api/holds', bo.sessionToken, {
      auctionId,
      ceilingCents: 50000,
    });
    expect(second.status).toBe(201);
    const boHold = CreateHoldResponse.parse(await second.json());
    const boPath = `/api/holds/${encodeURIComponent(boHold.holdId)}`;
    expect((await call(url, 'DELETE', boPath, ada.sessionToken)).status).toBe(404);
    for (let i = 0; i < 2; i += 1) {
      const released = await call(url, 'DELETE', boPath, bo.sessionToken);
      expect(released.status).toBe(200);
      expect(AbandonHoldResponse.parse(await released.json())).toEqual({
        holdId: boHold.holdId,
        released: true,
      });
    }
    const gone = await call(url, 'GET', boPath, bo.sessionToken);
    expect(HoldViewResponse.parse(await gone.json()).status).toBe('EXPIRED');
  });

  it('refuses new holds once the auctioneer hammered the lot', async () => {
    const { url } = await boot();
    const { auctionId, auctioneer, bo } = await auctionWithBidders(url);
    const hammer = await fetch(`${url}/api/auctions/${auctionId}/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${auctioneer}` },
      body: JSON.stringify({ controlId: 'hammer-1', action: 'hammer', args: { closeNow: 1 } }),
    });
    expect(hammer.status).toBe(200);
    const late = await call(url, 'POST', '/api/holds', bo.sessionToken, {
      auctionId,
      ceilingCents: 30000,
    });
    expect(late.status).toBe(409);
    expect(((await late.json()) as { code: string }).code).toBe('closed');
  });

  it('registers the bidder in the room once, when the approval names them (issue 1074)', async () => {
    const { url, paypal } = await boot();
    const { auctionId, auctioneer, ada, bo } = await auctionWithBidders(url);
    const created = await call(url, 'POST', '/api/holds', ada.sessionToken, {
      auctionId,
      ceilingCents: 30000,
    });
    const order = CreateHoldResponse.parse(await created.json());
    const approvePath = `/api/holds/${encodeURIComponent(order.holdId)}/approve`;
    paypal.core.approveOrder(order.orderId);

    const registered = async (): Promise<Array<{ bidderId: string; name: string }>> => {
      const res = await call(url, 'GET', `/api/auctions/${auctionId}/events?after=0`, auctioneer);
      const body = (await res.json()) as {
        events: Array<{ type?: string; bidderId?: string; name?: string }>;
      };
      return body.events.flatMap((e) =>
        e.type === 'bidder_registered' && e.bidderId !== undefined && e.name !== undefined
          ? [{ bidderId: e.bidderId, name: e.name }]
          : [],
      );
    };

    // Without a name only the hold is approved.
    expect(await registered()).toEqual([]);
    // A blank name is refused; another bidder's token cannot register this hold.
    const blank = await call(url, 'POST', approvePath, ada.sessionToken, {
      orderId: order.orderId,
      name: '  ',
    });
    expect(blank.status).toBe(400);
    const stolen = await call(url, 'POST', approvePath, bo.sessionToken, {
      orderId: order.orderId,
      name: 'Mallory',
    });
    expect(stolen.status).toBe(404);
    expect(await registered()).toEqual([]);

    // Approve with a name, twice: one registration, never two.
    for (let i = 0; i < 2; i += 1) {
      const approved = await call(url, 'POST', approvePath, ada.sessionToken, {
        orderId: order.orderId,
        name: 'Ada',
      });
      expect(approved.status).toBe(200);
      expect(ApproveHoldResponse.parse(await approved.json()).status).toBe('HELD');
    }
    expect(await registered()).toEqual([{ bidderId: ada.bidderId, name: 'Ada' }]);
  });
});
