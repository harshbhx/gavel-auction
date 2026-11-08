import { ManualClock, SeqIds, type AuctionConfig, type AuctionId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { secretSetFromConfig } from '../src/auth/rotation';
import { createHttpApp, type HttpApp, type HttpDeps } from '../src/http/app';
import { mountAuctions } from '../src/http/auctions';
import { Room, type RoomDeps } from '../src/room/room';
import { LedgerEngine } from '../src/runtime/ledger-engine';
import { MemoryStore } from '../src/store/memory-store';

const START = 1_789_000_000_000;
const ADMIN = 'fake-admin-key';
const SECRET = 'fake-secret-fake-secret-fake-0000';

export const validConfig = {
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

function setup(): { app: HttpApp; deps: HttpDeps; store: MemoryStore; clock: ManualClock } {
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
      createAuction: (id, config: AuctionConfig, sub) => {
        const p = Room.create(id, config, sub, roomDeps(id));
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
  return { app: createHttpApp(deps, [mountAuctions]), deps, store, clock };
}

const create = (app: HttpApp, body: unknown, key: string | null = ADMIN) =>
  app.fetch(
    new Request('http://h.test/api/auctions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key === null ? {} : { 'x-admin-key': key }),
      },
      body: JSON.stringify(body),
    }),
  );

describe('create auction (T-RT-073)', () => {
  it('creates with the admin key and returns the id and two links', async () => {
    const { app, store } = setup();
    const res = await create(app, { title: 'Gala lot', config: validConfig });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual([
      'auctionId',
      'auctioneerLink',
      'joinCode',
      'lotTitle',
      'screenLink',
    ]);
    expect(body.lotTitle).toBe('Gala lot');
    expect(body.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(body.auctioneerLink).toContain(`/r/${body.auctionId}/console#token=`);
    expect(body.screenLink).toContain(`/r/${body.auctionId}/screen#token=`);
    expect(await store.lastSeq(body.auctionId as AuctionId)).toBe(1);
  });

  it('answers a missing or wrong key with 401', async () => {
    const { app } = setup();
    expect((await create(app, { config: validConfig }, null)).status).toBe(401);
    expect((await create(app, { config: validConfig }, 'nope')).status).toBe(401);
  });

  it('answers an invalid config with 400 and field paths', async () => {
    const { app } = setup();
    const res = await create(app, { config: { ...validConfig, reserve: 5, currency: 'EUR' } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; detail: string };
    expect(body.code).toBe('bad_message');
    expect(body.detail).toContain('config.reserve');
    expect(body.detail).toContain('config.currency');
  });
});

describe('public summary (T-RT-074)', () => {
  it('adds the price and leader paddle only once a bid stands', async () => {
    const { app } = setup();
    const made = (await (await create(app, { title: 'Gala lot', config: validConfig })).json()) as {
      auctionId: string;
    };
    const res = await app.fetch(new Request(`http://h.test/api/auctions/${made.auctionId}`));
    const body = (await res.json()) as Record<string, unknown>;
    expect('currentCents' in body).toBe(false);
    expect('leaderPaddle' in body).toBe(false);
  });

  it('is public and lists title, status, end time and bidder count only', async () => {
    const { app } = setup();
    const made = (await (await create(app, { title: 'Gala lot', config: validConfig })).json()) as {
      auctionId: string;
      joinCode: string;
    };
    const res = await app.fetch(new Request(`http://h.test/api/auctions/${made.auctionId}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      auctionId: made.auctionId,
      title: 'Gala lot',
      joinCode: made.joinCode,
      status: 'OPEN',
      endTs: START + 600_000,
      bidderCount: 0,
    });
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/ceiling|token|sub/i);
  });

  it('resolves a join code, in any case, to the same summary', async () => {
    const { app } = setup();
    const made = (await (await create(app, { title: 'Gala lot', config: validConfig })).json()) as {
      auctionId: string;
      joinCode: string;
    };
    const res = await app.fetch(
      new Request(`http://h.test/api/auctions/${made.joinCode.toLowerCase()}`),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { auctionId: string }).auctionId).toBe(made.auctionId);
    const miss = await app.fetch(new Request('http://h.test/api/auctions/ZZZZZZ'));
    expect(miss.status).toBe(404);
  });

  it('gives every auction its own join code', async () => {
    const { app } = setup();
    const codes = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const made = (await (await create(app, { config: validConfig })).json()) as {
        joinCode: string;
      };
      codes.add(made.joinCode);
    }
    expect(codes.size).toBe(25);
  });

  it('answers an unknown or malformed id with 404', async () => {
    const { app } = setup();
    for (const id of ['01J9ZQ4Y6Z8K3M5N7P9R1S3T5V', 'not-an-id']) {
      const res = await app.fetch(new Request(`http://h.test/api/auctions/${id}`));
      expect(res.status).toBe(404);
    }
  });
});
