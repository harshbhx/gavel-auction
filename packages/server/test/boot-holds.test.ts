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
import { Room } from '../src/room/room';

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
async function boot(): Promise<{ url: string; paypal: FakePayPalServer; app: Composed }> {
  const app = await composeServer(env, { sink: () => undefined });
  running.push(app);
  const url = `http://127.0.0.1:${String(await app.listen(0))}`;
  const paypal = fakes.at(-1);
  if (paypal === undefined) throw new Error('the composition started no fake PayPal');
  return { url, paypal, app };
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
      ceilingCents: 99,
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

    const registered = async (): Promise<Array<{ bidderId: string; paddle: number }>> => {
      const res = await call(url, 'GET', `/api/auctions/${auctionId}/events?after=0`, auctioneer);
      const body = (await res.json()) as {
        events: Array<{ type?: string; bidderId?: string; paddle?: number }>;
      };
      return body.events.flatMap((e) =>
        e.type === 'bidder_registered' && e.bidderId !== undefined && e.paddle !== undefined
          ? [{ bidderId: e.bidderId, paddle: e.paddle }]
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
    expect(await registered()).toEqual([{ bidderId: ada.bidderId, paddle: 1 }]);
  });

  it('refuses a name with control characters before any authorization', async () => {
    const { url, paypal } = await boot();
    const { auctionId, ada } = await auctionWithBidders(url);
    const created = await call(url, 'POST', '/api/holds', ada.sessionToken, {
      auctionId,
      ceilingCents: 30000,
    });
    const order = CreateHoldResponse.parse(await created.json());
    const approvePath = `/api/holds/${encodeURIComponent(order.holdId)}/approve`;
    paypal.core.approveOrder(order.orderId);

    const before = paypal.core.calls.filter((c) => c.op === 'authorize' || c.op === 'void').length;
    const bad = await call(url, 'POST', approvePath, ada.sessionToken, {
      orderId: order.orderId,
      name: 'Ada\tLovelace',
    });
    expect(bad.status).toBe(400);
    const after = paypal.core.calls.filter((c) => c.op === 'authorize' || c.op === 'void').length;
    expect(after - before).toBe(0);
  });

  describe('FEAT-61 raising a limit', () => {
    /** Registers Ada with a hold of `ceilingCents` and returns what the raise tests need. */
    async function registeredAda(ceilingCents = 30000) {
      const booted = await boot();
      const auction = await auctionWithBidders(booted.url);
      const { url, paypal } = booted;
      const { auctionId, ada } = auction;
      const hold = async (cents: number, name?: string) => {
        const created = await call(url, 'POST', '/api/holds', ada.sessionToken, {
          auctionId,
          ceilingCents: cents,
        });
        if (created.status !== 201) return { created };
        const order = CreateHoldResponse.parse(await created.json());
        paypal.core.approveOrder(order.orderId);
        const approve = () =>
          call(
            url,
            'POST',
            `/api/holds/${encodeURIComponent(order.holdId)}/approve`,
            ada.sessionToken,
            { orderId: order.orderId, ...(name === undefined ? {} : { name }) },
          );
        return { created, order, approve };
      };
      const first = await hold(ceilingCents, 'Ada');
      expect((await first.approve?.())?.status).toBe(200);
      const ceilingOf = async (): Promise<number> => {
        const read = await call(
          url,
          'GET',
          `/api/holds/${encodeURIComponent(first.order?.holdId ?? '')}`,
          ada.sessionToken,
        );
        return HoldViewResponse.parse(await read.json()).ceilingCents;
      };
      return { ...booted, ...auction, hold, first, ceilingOf };
    }

    it('swaps the hold for a bigger one, voids the old one only afterwards, and is idempotent', async () => {
      const { url, paypal, auctionId, auctioneer, ada, hold, first } = await registeredAda();
      const voids = (): number => paypal.core.calls.filter((c) => c.op === 'void').length;
      expect(voids()).toBe(0);

      const raise = await hold(60000);
      expect(raise.created.status).toBe(201);
      // Ordering: the order exists and the old hold is untouched until the new one is approved.
      expect(voids()).toBe(0);
      const old = await call(
        url,
        'GET',
        `/api/holds/${encodeURIComponent(first.order?.holdId ?? '')}`,
        ada.sessionToken,
      );
      expect(HoldViewResponse.parse(await old.json()).status).toBe('HELD');

      // The same request again hands back the same order.
      const again = await hold(60000);
      expect(again.order).toEqual(raise.order);

      // Approving, with or without a name, twice: one raise, one void.
      for (let i = 0; i < 2; i += 1) {
        const res = await raise.approve?.();
        expect(res?.status).toBe(200);
        expect(ApproveHoldResponse.parse(await res?.json()).ceilingCents).toBe(60000);
      }
      expect(voids()).toBe(1);
      const oldAfter = await call(
        url,
        'GET',
        `/api/holds/${encodeURIComponent(first.order?.holdId ?? '')}`,
        ada.sessionToken,
      );
      expect(HoldViewResponse.parse(await oldAfter.json()).status).toBe('VOIDED');

      // The log has one registration and one raise; the auctioneer's copy has no amounts.
      const res = await call(url, 'GET', `/api/auctions/${auctionId}/events?after=0`, auctioneer);
      const events = ((await res.json()) as { events: Array<Record<string, unknown>> }).events;
      expect(events.filter((e) => e.type === 'bidder_registered')).toHaveLength(1);
      const raised = events.filter((e) => e.type === 'ceiling_raised');
      expect(raised).toHaveLength(1);
      expect(raised[0]).toMatchObject({ bidderId: ada.bidderId });
      expect(raised[0]).not.toHaveProperty('ceiling');
      expect(raised[0]).not.toHaveProperty('from');
      expect(raised[0]).not.toHaveProperty('holdRef');
    });

    it('refuses a limit that is not higher or is above the cap, and another bidder token', async () => {
      const { url, bo, hold, ceilingOf } = await registeredAda();
      expect((await hold(30000)).created.status).toBe(409);
      expect((await hold(20000)).created.status).toBe(409);
      const over = await hold(10_000_001);
      expect(over.created.status).toBe(400);
      expect(await holdError(over.created)).toBe('ceiling_out_of_range');
      expect(await ceilingOf()).toBe(30000);

      // Bo cannot approve Ada's raise.
      const raise = await hold(50000);
      const stolen = await call(
        url,
        'POST',
        `/api/holds/${encodeURIComponent(raise.order?.holdId ?? '')}/approve`,
        bo.sessionToken,
        { orderId: raise.order?.orderId },
      );
      expect(stolen.status).toBe(404);
    });

    it('lets a raise be retried when the room never took the approved hold (#2399)', async () => {
      const { url, paypal, ada, hold, first } = await registeredAda();
      const statusOf = async (holdId: string): Promise<string> => {
        const read = await call(
          url,
          'GET',
          `/api/holds/${encodeURIComponent(holdId)}`,
          ada.sessionToken,
        );
        return HoldViewResponse.parse(await read.json()).status;
      };
      const raise = await hold(60000);
      expect(raise.created.status).toBe(201);
      // The registration fails after PayPal authorized: the hold is approved, the room unchanged.
      const spy = vi
        .spyOn(Room.prototype, 'registerBidder')
        .mockRejectedValueOnce(new Error('store unavailable'));
      const failed = await raise.approve?.();
      spy.mockRestore();
      expect(failed?.status).toBeGreaterThanOrEqual(500);
      expect(await statusOf(first.order?.holdId ?? '')).toBe('HELD');
      // Asking for the same amount again hands back the same order, not hold_exists.
      const again = await hold(60000);
      expect(again.created.status).toBe(201);
      expect(again.order?.holdId).toBe(raise.order?.holdId);
      expect(again.order?.orderId).toBe(raise.order?.orderId);
      expect((await again.approve?.())?.status).toBe(200);
      // The room switched and the old authorization was voided; one authorization is live.
      expect(paypal.core.calls.filter((c) => c.op === 'void')).toHaveLength(1);
      expect(await statusOf(first.order?.holdId ?? '')).toBe('VOIDED');
      expect(await statusOf(raise.order?.holdId ?? '')).toBe('HELD');
    });

    it('voids an approved raise hold the room never took once it is old enough (#2399)', async () => {
      const { url, app, paypal, ada, hold } = await registeredAda();
      const raise = await hold(60000);
      const spy = vi
        .spyOn(Room.prototype, 'registerBidder')
        .mockRejectedValueOnce(new Error('store unavailable'));
      expect((await raise.approve?.())?.status).toBeGreaterThanOrEqual(500);
      spy.mockRestore();
      const voids = (): number => paypal.core.calls.filter((c) => c.op === 'void').length;
      // Too young: left alone, so a retry can still register it.
      await app.service.resume();
      expect(voids()).toBe(0);
      vi.useFakeTimers({ toFake: ['Date'], now: new SystemClock().now() + 11 * 60_000 });
      try {
        await app.service.resume();
      } finally {
        vi.useRealTimers();
      }
      expect(voids()).toBe(1);
      const read = await call(
        url,
        'GET',
        `/api/holds/${encodeURIComponent(raise.order?.holdId ?? '')}`,
        ada.sessionToken,
      );
      expect(HoldViewResponse.parse(await read.json()).status).toBe('VOIDED');
    });

    it('refuses the sixth raise and a raise below the step, before any PayPal order (#2397)', async () => {
      const { paypal, hold } = await registeredAda(10000);
      const orders = (): number => paypal.core.calls.filter((c) => c.op === 'order').length;
      const before = orders();
      const small = await hold(10001);
      expect(small.created.status).toBe(422);
      expect(HoldErrorResponse.parse(await small.created.json()).error).toBe('raise_too_small');
      expect(orders()).toBe(before);
      let ceiling = 10000;
      for (let n = 0; n < 5; n += 1) {
        ceiling = Math.round(ceiling * 1.1);
        // Cap on the demo: the server maximum is 100000 cents.
        const raise = await hold(ceiling);
        expect(raise.created.status).toBe(201);
        expect((await raise.approve?.())?.status).toBe(200);
      }
      const sixth = await hold(ceiling * 2);
      expect(sixth.created.status).toBe(409);
      expect(HoldErrorResponse.parse(await sixth.created.json()).error).toBe('raise_limit_reached');
    });

    it('refuses a raise once the lot is hammered and keeps the old hold', async () => {
      const { url, auctionId, auctioneer, hold, ceilingOf } = await registeredAda();
      const raise = await hold(50000);
      expect(raise.created.status).toBe(201);
      const hammer = await fetch(`${url}/api/auctions/${auctionId}/control`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${auctioneer}` },
        body: JSON.stringify({ controlId: 'hammer-2', action: 'hammer', args: { closeNow: 1 } }),
      });
      expect(hammer.status).toBe(200);
      const late = await raise.approve?.();
      expect(late?.status).toBe(409);
      expect((await hold(70000)).created.status).toBe(409);
      expect(await ceilingOf()).toBe(30000);
    });
  });
});
