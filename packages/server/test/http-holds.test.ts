import { GavelError, ManualClock, SeqIds, type AuctionConfig, type AuctionId } from '@gavel/shared';
import { HoldError, type HoldRecord } from '@gavel/payments';
import { describe, expect, it } from 'vitest';
import { secretSetFromConfig } from '../src/auth/rotation';
import { createHttpApp, mintToken, type HttpApp, type HttpDeps } from '../src/http/app';
import { mountAuctions } from '../src/http/auctions';
import { mountHolds, type HoldsPort } from '../src/http/holds';
import { Room, type RoomDeps } from '../src/room/room';
import { LedgerEngine } from '../src/runtime/ledger-engine';
import { MemoryStore } from '../src/store/memory-store';

const START = 1_789_000_000_000;
const ADMIN = 'fake-admin-key';
const SECRET = 'fake-secret-fake-secret-fake-0000';

const config = {
  mode: 'english',
  currency: 'USD',
  reserve: 10000,
  minIncrement: 500,
  endTs: START + 600_000,
  softCloseWindowMs: 30_000,
  softCloseExtensionMs: 30_000,
  maxExtensions: 5,
  ceilingPresets: [30000, 50000],
  confirmConfidenceThreshold: 0.85,
};

interface Calls {
  created: unknown[];
  approved: unknown[];
  abandoned: string[];
  /** Holds the service was told about after their approval. */
  told: string[];
}

interface Setup {
  app: HttpApp;
  deps: HttpDeps;
  calls: Calls;
  records: Map<string, HoldRecord>;
  /** Auctions the stub says no longer take holds. */
  closed: Set<string>;
}

function setup(extra: Partial<HoldsPort> = {}): Setup {
  const clock = new ManualClock(START);
  const ids = new SeqIds();
  const store = new MemoryStore(() => clock.now());
  const rooms = new Map<string, Promise<Room>>();
  const roomDeps = (id: AuctionId): RoomDeps => ({
    store,
    clock,
    ids,
    engine: (cfg) => new LedgerEngine(id, cfg),
  });
  const deps: HttpDeps = {
    service: {
      createAuction: (id, cfg: AuctionConfig, sub) => {
        const p = Room.create(id, cfg, sub, roomDeps(id));
        rooms.set(id, p);
        return p;
      },
      room: (id) => {
        const known = rooms.get(id);
        if (known !== undefined) return known;
        const p = Room.load(id, roomDeps(id));
        rooms.set(id, p);
        return p;
      },
    },
    store,
    clock,
    ids,
    secrets: secretSetFromConfig({ TOKEN_SECRET: SECRET }),
    adminKey: ADMIN,
    publicUrl: 'https://gavel.example.test',
    corsOrigins: [],
  };
  const calls: Calls = { created: [], approved: [], abandoned: [], told: [] };
  const records = new Map<string, HoldRecord>();
  const closed = new Set<string>();
  const port: HoldsPort = {
    service: {
      createHoldOrder: async (i) => {
        calls.created.push(i);
        if (i.ceilingCents === 12345) throw new HoldError('ceiling_out_of_range', 'not a preset');
        return { holdId: 'hold-1', orderId: 'order-1' };
      },
      completeApproval: async (i) => {
        calls.approved.push(i);
        return { holdId: i.holdId, status: 'HELD', ceilingCents: 30000 };
      },
      abandonHold: async (id) => {
        calls.abandoned.push(id);
        const rec = records.get(id);
        if (rec === undefined) return false;
        if (rec.status === 'EXPIRED') return true;
        if (rec.status !== 'PENDING_APPROVAL' || rec.authId !== undefined) return false;
        records.set(id, { ...rec, status: 'EXPIRED' });
        return true;
      },
    },
    store: { get: async (id) => records.get(id) ?? null },
    acceptsHolds: async (id) => !closed.has(id),
    approved: async (id) => {
      calls.told.push(id);
    },
    ...extra,
  };
  return {
    app: createHttpApp(deps, [mountAuctions, mountHolds(port)]),
    deps,
    calls,
    records,
    closed,
  };
}

async function newAuction(app: HttpApp): Promise<string> {
  const res = await app.fetch(
    new Request('http://h.test/api/auctions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN },
      body: JSON.stringify({ title: 'Gala lot', config }),
    }),
  );
  return ((await res.json()) as { auctionId: string }).auctionId;
}

const post = (app: HttpApp, path: string, body: unknown, token: string | null) =>
  app.fetch(
    new Request(`http://h.test${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    }),
  );

describe('hold routes (INT-R3-20)', () => {
  it('creates a hold order for the session bidder with the auction presets', async () => {
    const { app, deps, calls } = setup();
    const auctionId = await newAuction(app);
    const bidder = deps.ids.mint<'BidderId'>();
    const m = await mintToken(deps, 'session', auctionId, bidder, bidder);
    const res = await post(app, '/api/holds', { auctionId, ceilingCents: 30000 }, m.token);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ holdId: 'hold-1', orderId: 'order-1' });
    expect(calls.created).toEqual([
      { auctionId, bidderId: bidder, ceilingCents: 30000, presetsCents: [30000, 50000] },
    ]);
  });

  it('refuses a body that names a bidder and a request with no token', async () => {
    const { app, deps } = setup();
    const auctionId = await newAuction(app);
    const bidder = deps.ids.mint<'BidderId'>();
    const m = await mintToken(deps, 'session', auctionId, bidder, bidder);
    const named = await post(
      app,
      '/api/holds',
      { auctionId, ceilingCents: 30000, bidderId: 'x' },
      m.token,
    );
    expect(named.status).toBe(400);
    const anon = await post(app, '/api/holds', { auctionId, ceilingCents: 30000 }, null);
    expect(anon.status).toBe(401);
  });

  it('answers a payments error with the contract status and code', async () => {
    const { app, deps } = setup();
    const auctionId = await newAuction(app);
    const bidder = deps.ids.mint<'BidderId'>();
    const m = await mintToken(deps, 'session', auctionId, bidder, bidder);
    const res = await post(app, '/api/holds', { auctionId, ceilingCents: 12345 }, m.token);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('ceiling_out_of_range');
  });

  it('approves only for the owner and answers anyone else as not found', async () => {
    const { app, deps, calls, records } = setup();
    const auctionId = await newAuction(app);
    const owner = deps.ids.mint<'BidderId'>();
    const other = deps.ids.mint<'BidderId'>();
    records.set('hold-1', {
      holdId: 'hold-1',
      auctionId,
      bidderId: owner,
      orderId: 'order-1',
      ceilingCents: 30000,
      status: 'PENDING_APPROVAL',
      createdAtMs: START,
    });
    const mine = await mintToken(deps, 'session', auctionId, owner, owner);
    const theirs = await mintToken(deps, 'session', auctionId, other, other);
    const denied = await post(
      app,
      '/api/holds/hold-1/approve',
      { orderId: 'order-1' },
      theirs.token,
    );
    expect(denied.status).toBe(404);
    expect(calls.approved).toEqual([]);
    const ok = await post(app, '/api/holds/hold-1/approve', { orderId: 'order-1' }, mine.token);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ holdId: 'hold-1', status: 'HELD', ceilingCents: 30000 });
    const unknown = await post(app, '/api/holds/nope/approve', { orderId: 'order-1' }, mine.token);
    expect(unknown.status).toBe(404);
  });

  it('abandons a hold for its owner only and answers anyone else as not found', async () => {
    const { app, deps, calls, records } = setup();
    const auctionId = await newAuction(app);
    const owner = deps.ids.mint<'BidderId'>();
    const other = deps.ids.mint<'BidderId'>();
    records.set('hold-1', {
      holdId: 'hold-1',
      auctionId,
      bidderId: owner,
      orderId: 'order-1',
      ceilingCents: 30000,
      status: 'PENDING_APPROVAL',
      createdAtMs: START,
    });
    const mine = await mintToken(deps, 'session', auctionId, owner, owner);
    const theirs = await mintToken(deps, 'session', auctionId, other, other);
    const del = (path: string, token: string | null) =>
      app.fetch(
        new Request(`http://h.test${path}`, {
          method: 'DELETE',
          headers: token === null ? {} : { authorization: `Bearer ${token}` },
        }),
      );
    expect((await del('/api/holds/hold-1', null)).status).toBe(401);
    expect((await del('/api/holds/hold-1', theirs.token)).status).toBe(404);
    expect((await del('/api/holds/nope', mine.token)).status).toBe(404);
    expect(calls.abandoned).toEqual([]);
    const ok = await del('/api/holds/hold-1', mine.token);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ holdId: 'hold-1', released: true });
    const again = await del('/api/holds/hold-1', mine.token);
    expect(again.status).toBe(200);
    expect(calls.abandoned).toEqual(['hold-1', 'hold-1']);
  });

  it('answers 409 hold_exists when the hold is authorized or captured and keeps it', async () => {
    const { app, deps, records } = setup();
    const auctionId = await newAuction(app);
    const owner = deps.ids.mint<'BidderId'>();
    const mine = await mintToken(deps, 'session', auctionId, owner, owner);
    const base = {
      auctionId,
      bidderId: owner,
      orderId: 'order-1',
      ceilingCents: 30000,
      createdAtMs: START,
    };
    for (const status of ['HELD', 'CAPTURED'] as const) {
      records.set('hold-1', { ...base, holdId: 'hold-1', status, authId: 'auth-1' });
      const res = await app.fetch(
        new Request('http://h.test/api/holds/hold-1', {
          method: 'DELETE',
          headers: { authorization: `Bearer ${mine.token}` },
        }),
      );
      expect(res.status).toBe(409);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('hold_exists');
      expect(body).not.toHaveProperty('released');
      expect(body).not.toHaveProperty('ceilingCents');
      expect(records.get('hold-1')?.status).toBe(status);
    }
  });

  it('refuses a new order and an approval once the auction no longer takes holds', async () => {
    const { app, deps, calls, records, closed } = setup();
    const auctionId = await newAuction(app);
    const owner = deps.ids.mint<'BidderId'>();
    const mine = await mintToken(deps, 'session', auctionId, owner, owner);
    records.set('hold-1', {
      holdId: 'hold-1',
      auctionId,
      bidderId: owner,
      orderId: 'order-1',
      ceilingCents: 30000,
      status: 'PENDING_APPROVAL',
      createdAtMs: START,
    });
    closed.add(auctionId);
    const created = await post(app, '/api/holds', { auctionId, ceilingCents: 30000 }, mine.token);
    expect(created.status).toBe(409);
    expect(((await created.json()) as { code: string }).code).toBe('closed');
    const approved = await post(
      app,
      '/api/holds/hold-1/approve',
      { orderId: 'order-1' },
      mine.token,
    );
    expect(approved.status).toBe(409);
    expect(calls.created).toEqual([]);
    expect(calls.approved).toEqual([]);
    // Abandoning still works: it only ever releases.
    const released = await app.fetch(
      new Request('http://h.test/api/holds/hold-1', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${mine.token}` },
      }),
    );
    expect(released.status).toBe(200);
  });
  it('tells the service once a hold is approved, and not when the approval is refused (HRD-76)', async () => {
    const { app, deps, calls, records, closed } = setup();
    const auctionId = await newAuction(app);
    const owner = deps.ids.mint<'BidderId'>();
    const mine = await mintToken(deps, 'session', auctionId, owner, owner);
    records.set('hold-1', {
      holdId: 'hold-1',
      auctionId,
      bidderId: owner,
      orderId: 'order-1',
      ceilingCents: 30000,
      status: 'PENDING_APPROVAL',
      createdAtMs: START,
    });
    const ok = await post(app, '/api/holds/hold-1/approve', { orderId: 'order-1' }, mine.token);
    expect(ok.status).toBe(200);
    expect(calls.told).toEqual(['hold-1']);
    closed.add(auctionId);
    const refused = await post(
      app,
      '/api/holds/hold-1/approve',
      { orderId: 'order-1' },
      mine.token,
    );
    expect(refused.status).toBe(409);
    expect(calls.told).toEqual(['hold-1']);
  });

  it('tells the service about the approval when the registration after it is refused (HRD-76)', async () => {
    const { app, deps, calls, records } = setup({
      registerBidder: async () => {
        throw new GavelError('conflict', 'auction is hammered');
      },
    });
    const auctionId = await newAuction(app);
    const owner = deps.ids.mint<'BidderId'>();
    const mine = await mintToken(deps, 'session', auctionId, owner, owner);
    records.set('hold-1', {
      holdId: 'hold-1',
      auctionId,
      bidderId: owner,
      orderId: 'order-1',
      ceilingCents: 30000,
      status: 'PENDING_APPROVAL',
      createdAtMs: START,
    });
    const res = await post(
      app,
      '/api/holds/hold-1/approve',
      { orderId: 'order-1', name: 'Late Bidder' },
      mine.token,
    );
    expect(res.status).not.toBe(200);
    expect(calls.approved).toHaveLength(1);
    expect(calls.told).toEqual(['hold-1']);
  });
});
