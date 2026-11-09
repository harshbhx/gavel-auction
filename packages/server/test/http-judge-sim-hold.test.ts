import {
  GavelError,
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type AuctionId,
  type Cents,
  EpochMs,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { secretSetFromConfig } from '../src/auth/rotation';
import { createHttpApp, type HttpApp, type HttpDeps } from '../src/http/app';
import { mountAuctions } from '../src/http/auctions';
import {
  createJudgeRooms,
  JUDGE_SIM_HOLD_PATH,
  type SimHolds,
  JUDGE_JOIN_PATH,
  JUDGE_ROOMS_PATH,
  judgeRoomConfig,
  type JudgeRoomsOptions,
} from '../src/http/judge-rooms';
import { requestSources } from '../src/http/node-bridge';
import { Room, type RoomDeps } from '../src/room/room';
import { LedgerEngine } from '../src/runtime/ledger-engine';
import { MemoryStore } from '../src/store/memory-store';

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

/** A normal auction made with the operator key. */
const createNormal = async (
  app: HttpApp,
  clock: ManualClock,
): Promise<{ auctionId: string; joinCode: string }> => {
  const config = judgeRoomConfig(clock.now(), {
    lotWindowMs: 600_000,
    maxCeilingCents: 5_000 as Cents,
  });
  const res = await post(app, '/api/auctions', {
    headers: { 'x-admin-key': ADMIN },
    body: { title: 'Normal lot', config: { ...config, endTs: EpochMs(clock.now() + 600_000) } },
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { auctionId: string; joinCode: string };
};

interface Placed {
  auctionId: string;
  bidderId: string;
  name: string;
  ceilingCents: number;
}

function fakeSim(placed: Placed[], open = true): SimHolds {
  return {
    acceptsHolds: () => Promise.resolve(open),
    place: (input) => {
      placed.push(input);
      return Promise.resolve(`sim-hold-${input.bidderId}`);
    },
  };
}

const joinRoom = async (
  app: HttpApp,
  code: string,
): Promise<{ sessionToken: string; bidderId: string }> => {
  const res = await post(app, JUDGE_JOIN_PATH, { body: { code, displayName: 'Ada' } });
  expect(res.status).toBe(200);
  return (await res.json()) as { sessionToken: string; bidderId: string };
};

const simHold = (
  app: HttpApp,
  auctionId: string,
  token: string | null,
  body: unknown,
): Promise<Response> =>
  post(app, JUDGE_SIM_HOLD_PATH.replace(':id', auctionId), {
    body,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });

describe('judge simulated hold (SRV-34)', () => {
  it('places a simulated hold for a joined bidder with an offered ceiling', async () => {
    const placed: Placed[] = [];
    const { app } = setup({ simHolds: fakeSim(placed) });
    const room = await createRoom(app);
    const who = await joinRoom(app, room.joinCode);
    const res = await simHold(app, room.auctionId, who.sessionToken, {
      ceilingCents: 5_000,
      name: 'Ada',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      holdId: `sim-hold-${who.bidderId}`,
      simulated: true,
      ceilingCents: 5_000,
    });
    expect(placed).toEqual([
      { auctionId: room.auctionId, bidderId: who.bidderId, name: 'Ada', ceilingCents: 5_000 },
    ]);
  });

  it('answers a refused repeat hold with 409 and no second write (#2064, #2065)', async () => {
    const seen = new Map<string, number>();
    const sim: SimHolds = {
      acceptsHolds: () => Promise.resolve(true),
      place: (i) => {
        const first = seen.get(i.bidderId);
        if (first !== undefined && first !== i.ceilingCents) {
          return Promise.reject(new GavelError('conflict', 'this bidder already has a hold'));
        }
        seen.set(i.bidderId, i.ceilingCents);
        return Promise.resolve(`sim-hold-${i.bidderId}`);
      },
    };
    const { app } = setup({ simHolds: sim });
    const room = await createRoom(app);
    const who = await joinRoom(app, room.joinCode);
    const go = (ceilingCents: number): Promise<Response> =>
      simHold(app, room.auctionId, who.sessionToken, { ceilingCents, name: 'Ada' });
    expect((await go(5_000)).status).toBe(200);
    expect((await go(5_000)).status).toBe(200);
    expect((await go(2_000)).status).toBe(409);
    expect(seen.get(who.bidderId)).toBe(5_000);
  });

  it('refuses a ceiling that is not offered, a bad name and extra fields', async () => {
    const placed: Placed[] = [];
    const { app } = setup({ simHolds: fakeSim(placed) });
    const room = await createRoom(app);
    const who = await joinRoom(app, room.joinCode);
    const go = (body: unknown): Promise<Response> =>
      simHold(app, room.auctionId, who.sessionToken, body);
    expect((await go({ ceilingCents: 4_999, name: 'Ada' })).status).toBe(400);
    expect((await go({ ceilingCents: 5_000, name: 'a<b>' })).status).toBe(400);
    expect((await go({ ceilingCents: 5_000, name: 'Ada', x: 1 })).status).toBe(400);
    expect(placed).toEqual([]);
  });

  it('needs a bidder session of the same room', async () => {
    const placed: Placed[] = [];
    const { app } = setup({ simHolds: fakeSim(placed) });
    const a = await createRoom(app);
    const b = await createRoom(app);
    const who = await joinRoom(app, a.joinCode);
    const body = { ceilingCents: 5_000, name: 'Ada' };
    expect((await simHold(app, a.auctionId, null, body)).status).toBe(401);
    expect((await simHold(app, b.auctionId, who.sessionToken, body)).status).toBeGreaterThanOrEqual(
      401,
    );
    expect(placed).toEqual([]);
  });

  it('never works for a normal auction', async () => {
    const placed: Placed[] = [];
    const { app, clock } = setup({ simHolds: fakeSim(placed) });
    const normal = await createNormal(app, clock);
    // A session for the normal auction, as an invite join would give.
    const invites = await post(app, `/api/auctions/${normal.auctionId}/invites`, {
      headers: { 'x-admin-key': ADMIN },
      body: { count: 1 },
    });
    expect(invites.status).toBeGreaterThanOrEqual(200);
    expect(placed).toEqual([]);
    const res = await simHold(app, normal.auctionId, 'not-a-real-token', {
      ceilingCents: 5_000,
      name: 'Ada',
    });
    expect([401, 403, 404]).toContain(res.status);
    expect(placed).toEqual([]);
  });

  it('answers 404 when the host leaves simulated holds off', async () => {
    const { app } = setup();
    const room = await createRoom(app);
    const who = await joinRoom(app, room.joinCode);
    const res = await simHold(app, room.auctionId, who.sessionToken, {
      ceilingCents: 5_000,
      name: 'Ada',
    });
    expect(res.status).toBe(404);
  });

  it('refuses once the room no longer takes holds, and once it expired', async () => {
    const closed = setup({ simHolds: fakeSim([], false) });
    const room = await createRoom(closed.app);
    const who = await joinRoom(closed.app, room.joinCode);
    const body = { ceilingCents: 5_000, name: 'Ada' };
    expect((await simHold(closed.app, room.auctionId, who.sessionToken, body)).status).toBe(409);

    const placed: Placed[] = [];
    const { app, clock } = setup({ simHolds: fakeSim(placed) });
    const r2 = await createRoom(app);
    const w2 = await joinRoom(app, r2.joinCode);
    clock.advance(31 * 60_000);
    const res = await simHold(app, r2.auctionId, w2.sessionToken, body);
    expect([401, 410]).toContain(res.status);
    expect(placed).toEqual([]);
  });

  it('shows simHolds in the capabilities probe only when the host has them', async () => {
    const on = setup({ simHolds: fakeSim([]) });
    const get = (app: HttpApp): Promise<Response> =>
      app.fetch(new Request('http://h.test/api/judge/capabilities'));
    expect(await (await get(on.app)).json()).toEqual({
      judgeRooms: true,
      accepting: true,
      simHolds: true,
    });
    const off = setup();
    expect(await (await get(off.app)).json()).toEqual({
      judgeRooms: true,
      accepting: true,
      simHolds: false,
    });
  });

  it('marks a judge room in the public summary and leaves a normal auction unmarked', async () => {
    const { app, clock } = setup({ simHolds: fakeSim([]) });
    const room = await createRoom(app);
    const normal = await createNormal(app, clock);
    const read = async (id: string): Promise<Record<string, unknown>> =>
      (await (await app.fetch(new Request(`http://h.test/api/auctions/${id}`))).json()) as Record<
        string,
        unknown
      >;
    expect((await read(room.auctionId)).judgeRoom).toBe(true);
    expect((await read(normal.auctionId)).judgeRoom).toBeUndefined();
  });
});
