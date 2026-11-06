import { ManualClock, SeqIds, type AuctionConfig, type AuctionId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { secretSetFromConfig } from '../src/auth/rotation';
import { createHttpApp, type HttpApp, type HttpDeps } from '../src/http/app';
import { mountAuctions } from '../src/http/auctions';
import { mountInvites } from '../src/http/invites';
import { Room, type RoomDeps } from '../src/room/room';
import { LedgerEngine } from '../src/runtime/ledger-engine';
import { MemoryStore } from '../src/store/memory-store';

const START = 1_789_000_000_000;
const ADMIN = 'fake-admin-key';

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

function setup(joinLimit?: HttpDeps['joinLimit']): { app: HttpApp } {
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
      room: (id) => rooms.get(id) ?? Room.load(id, roomDeps(id)),
    },
    store,
    clock,
    ids,
    secrets: secretSetFromConfig({ TOKEN_SECRET: 'fake-secret-fake-secret-fake-0000' }),
    adminKey: ADMIN,
    publicUrl: 'https://gavel.example.test',
    corsOrigins: [],
    ...(joinLimit ? { joinLimit } : {}),
  };
  return { app: createHttpApp(deps, [mountAuctions, mountInvites]) };
}

const tokenOf = (link: string): string => link.split('#token=')[1] ?? '';

async function created(app: HttpApp): Promise<{ id: string; auctioneer: string; screen: string }> {
  const res = await app.fetch(
    new Request('http://h.test/api/auctions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN },
      body: JSON.stringify({ config }),
    }),
  );
  const b = (await res.json()) as { auctionId: string; auctioneerLink: string; screenLink: string };
  return { id: b.auctionId, auctioneer: tokenOf(b.auctioneerLink), screen: tokenOf(b.screenLink) };
}

const call = (app: HttpApp, path: string, token: string | null, body: unknown) =>
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

const mint = async (app: HttpApp, id: string, auctioneer: string, count = 1): Promise<string[]> => {
  const res = await call(app, `/api/auctions/${id}/invites`, auctioneer, { count });
  expect(res.status).toBe(201);
  const b = (await res.json()) as { invites: Array<{ link: string }> };
  return b.invites.map((i) => tokenOf(i.link));
};

describe('invites and join (T-RT-075)', () => {
  it('lets the auctioneer mint invites and exchanges one for a session token', async () => {
    const { app } = setup();
    const a = await created(app);
    const [invite] = await mint(app, a.id, a.auctioneer, 3);
    const res = await call(app, `/api/auctions/${a.id}/join`, null, { invite });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionToken: string; bidderId: string; wsUrl: string };
    expect(body.wsUrl).toBe('wss://gavel.example.test/ws');
    expect(body.sessionToken.split('.')).toHaveLength(2);
    expect(body.bidderId).toHaveLength(26);
  });

  it('refuses a bidder token, a screen token, no token and a bad count', async () => {
    const { app } = setup();
    const a = await created(app);
    const [invite] = await mint(app, a.id, a.auctioneer);
    const join = (await (
      await call(app, `/api/auctions/${a.id}/join`, null, { invite })
    ).json()) as {
      sessionToken: string;
    };
    const path = `/api/auctions/${a.id}/invites`;
    expect((await call(app, path, join.sessionToken, {})).status).toBe(403);
    expect((await call(app, path, a.screen, {})).status).toBe(403);
    expect((await call(app, path, null, {})).status).toBe(401);
    expect((await call(app, path, a.auctioneer, { count: 51 })).status).toBe(400);
  });

  it('rejects an unknown auction and a token for another auction', async () => {
    const { app } = setup();
    const a = await created(app);
    const b = await created(app);
    expect((await call(app, `/api/auctions/${b.id}/invites`, a.auctioneer, {})).status).toBe(401);
    const ghost = '01J9ZQ4Y6Z8K3M5N7P9R1S3T5V';
    expect((await call(app, `/api/auctions/${ghost}/join`, null, { invite: 'x' })).status).toBe(
      404,
    );
  });
});

describe('invite single use (T-RT-061)', () => {
  it('lets exactly one of two concurrent exchanges succeed', async () => {
    const { app } = setup();
    const a = await created(app);
    const [invite] = await mint(app, a.id, a.auctioneer);
    const results = await Promise.all([
      call(app, `/api/auctions/${a.id}/join`, null, { invite }),
      call(app, `/api/auctions/${a.id}/join`, null, { invite }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const failed = results.find((r) => r.status === 409);
    expect(((await failed?.json()) as { code: string }).code).toBe('invite_used');
  });

  it('answers 429 with retry-after when the join limit is hit (R12-S11)', async () => {
    const { app } = setup(() => ({ ok: false, retryAfterMs: 2500 }));
    const a = await created(app);
    const [invite] = await mint(app, a.id, a.auctioneer);
    const res = await call(app, `/api/auctions/${a.id}/join`, null, { invite });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3');
  });

  it('applies a default join limit when the host passes none (R12-S11)', async () => {
    const { app } = setup();
    const a = await created(app);
    const [invite] = await mint(app, a.id, a.auctioneer);
    let last = 0;
    for (let i = 0; i < 42; i++) {
      last = (await call(app, `/api/auctions/${a.id}/join`, null, { invite: `${invite}x` })).status;
    }
    expect(last).toBe(429);
  });
});

describe('join limiter fallback (issue 1866)', () => {
  it('ignores a spoofed x-forwarded-for and shares one bucket', async () => {
    const { app } = setup();
    const ghost = '01J9ZQ4Y6Z8K3M5N7P9R1S3T5V';
    let limited = 0;
    for (let i = 0; i < 45; i++) {
      const res = await app.fetch(
        new Request(`http://h.test/api/auctions/${ghost}/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${i}` },
          body: JSON.stringify({ invite: 'x' }),
        }),
      );
      if (res.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });
});
