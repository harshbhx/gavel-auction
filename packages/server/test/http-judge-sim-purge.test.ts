import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type AuctionId,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { secretSetFromConfig } from '../src/auth/rotation';
import { createHttpApp, type HttpApp, type HttpDeps } from '../src/http/app';
import { mountAuctions } from '../src/http/auctions';
import {
  createJudgeRooms,
  SIM_PURGE_GRACE_MS,
  type SimHolds,
  JUDGE_ROOMS_PATH,
  type JudgeRoomsOptions,
} from '../src/http/judge-rooms';
import { requestSources } from '../src/http/node-bridge';
import { Room, type RoomDeps } from '../src/room/room';
import { LedgerEngine } from '../src/runtime/ledger-engine';
import { MemoryStore } from '../src/store/memory-store';
import { MemoryHoldStore } from '@gavel/payments';
import { purgeSimHolds, SIM_AUTH_PREFIX } from '../src/http/sim-holds';

const START = 1_789_000_000_000;
const ADMIN = 'fake-admin-key-fake-admin-key';
const SECRET = 'fake-secret-fake-secret-fake-0000';

const OPTS: JudgeRoomsOptions = {
  enabled: true,
  paused: false,
  maxLive: 10,
  ttlMs: 30 * 60_000,
  perIpPerHour: 50,
  globalPerHour: 100,
  maxCeilingCents: 5_000,
  lotWindowMs: 10 * 60_000,
};

interface Setup {
  app: HttpApp;
  clock: ManualClock;
  rooms: ReturnType<typeof createJudgeRooms>;
}

function setup(over: Partial<JudgeRoomsOptions> = {}): Setup {
  const clock = new ManualClock(START);
  const ids = new SeqIds();
  const store = new MemoryStore(() => clock.now());
  const live = new Map<string, Promise<Room>>();
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
        live.set(id, p);
        return p;
      },
      room: (id) => {
        const known = live.get(id);
        if (known !== undefined) return known;
        const p = Room.load(id, roomDeps(id));
        live.set(id, p);
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
  const rooms = createJudgeRooms({ ...OPTS, ...over });
  const app = createHttpApp(deps, [mountAuctions, rooms.mount]);
  return { app, clock, rooms };
}

const post = (
  app: HttpApp,
  path: string,
  opts: { src?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> => {
  const req = new Request(`http://h.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    body: JSON.stringify(opts.body ?? {}),
  });
  requestSources.set(req, opts.src ?? '203.0.113.7');
  return app.fetch(req);
};

const createRoom = async (app: HttpApp): Promise<{ auctionId: string; joinCode: string }> => {
  const res = await post(app, JUDGE_ROOMS_PATH, { src: '10.0.0.1' });
  expect(res.status).toBe(201);
  return (await res.json()) as { auctionId: string; joinCode: string };
};

const hold = (auctionId: string, holdId: string, authId: string, bidderId = holdId) => ({
  holdId,
  auctionId,
  bidderId,
  orderId: `order-${holdId}`,
  authId,
  ceilingCents: 1_000,
  status: 'HELD' as const,
  createdAtMs: START,
});

describe('judge room simulated hold purge (#2232)', () => {
  it('purgeSimHolds drops only simulated holds of that auction, with one write', async () => {
    let writes = 0;
    const holds = new MemoryHoldStore(undefined, () => {
      writes += 1;
    });
    await holds.put(hold('a1', 'sim-hold-b1', `${SIM_AUTH_PREFIX}b1-1000`));
    await holds.put(hold('a1', 'sim-hold-b2', `${SIM_AUTH_PREFIX}b2-1000`));
    await holds.put(hold('a1', 'real-hold-1', 'PAYPAL-AUTH-1'));
    // A sim-looking id without a simulated authorization is not ours to delete.
    await holds.put(hold('a1', 'sim-hold-odd', 'PAYPAL-AUTH-2'));
    await holds.put(hold('a2', 'sim-hold-b3', `${SIM_AUTH_PREFIX}b3-1000`));
    writes = 0;
    expect(await purgeSimHolds(holds, 'a1')).toBe(2);
    expect(writes).toBe(1);
    expect((await holds.listByAuction('a1')).map((h) => h.holdId).sort()).toEqual([
      'real-hold-1',
      'sim-hold-odd',
    ]);
    expect((await holds.listByAuction('a2')).map((h) => h.holdId)).toEqual(['sim-hold-b3']);
    expect(await purgeSimHolds(holds, 'a1')).toBe(0);
    expect(writes).toBe(1);
  });

  it('purgeSimHolds is a no-op on a store without deleteByAuction', async () => {
    const holds = new MemoryHoldStore();
    const bare = {
      get: holds.get.bind(holds),
      byBidder: holds.byBidder.bind(holds),
      put: holds.put.bind(holds),
      listByAuction: holds.listByAuction.bind(holds),
    };
    expect(await purgeSimHolds(bare, 'a1')).toBe(0);
  });

  it('purges an expired room sim holds after the grace, never earlier, and keeps real holds', async () => {
    const holds = new MemoryHoldStore();
    const sim: SimHolds = {
      acceptsHolds: () => Promise.resolve(true),
      place: () => Promise.resolve('unused'),
      purge: (auctionId) => purgeSimHolds(holds, auctionId),
    };
    const { app, clock, rooms } = setup({ simHolds: sim });
    const room = await createRoom(app);
    await holds.put(hold(room.auctionId, 'sim-hold-x', `${SIM_AUTH_PREFIX}x-1000`));
    await holds.put(hold(room.auctionId, 'sim-hold-y', `${SIM_AUTH_PREFIX}y-1000`));
    await holds.put(hold(room.auctionId, 'real-1', 'PAYPAL-AUTH-9'));

    clock.set(clock.now() + OPTS.ttlMs + 1);
    expect(await rooms.sweep()).toBe(1);
    expect(await holds.listByAuction(room.auctionId)).toHaveLength(3);

    clock.set(clock.now() + SIM_PURGE_GRACE_MS - 1_000);
    await rooms.sweep();
    expect(await holds.listByAuction(room.auctionId)).toHaveLength(3);

    clock.set(clock.now() + 2_000);
    await rooms.sweep();
    expect((await holds.listByAuction(room.auctionId)).map((h) => h.holdId)).toEqual(['real-1']);
  });

  it('a live room keeps its sim holds', async () => {
    const holds = new MemoryHoldStore();
    const sim: SimHolds = {
      acceptsHolds: () => Promise.resolve(true),
      place: () => Promise.resolve('unused'),
      purge: (auctionId) => purgeSimHolds(holds, auctionId),
    };
    const { app, clock, rooms } = setup({ simHolds: sim });
    const room = await createRoom(app);
    await holds.put(hold(room.auctionId, 'sim-hold-x', `${SIM_AUTH_PREFIX}x-1000`));
    clock.set(clock.now() + 60_000);
    await rooms.sweep();
    expect(await holds.listByAuction(room.auctionId)).toHaveLength(1);
  });
});
