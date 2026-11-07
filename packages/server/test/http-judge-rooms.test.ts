import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type AuctionId,
  type Logger,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { secretSetFromConfig } from '../src/auth/rotation';
import { createHttpApp, type HttpApp, type HttpDeps } from '../src/http/app';
import { mountAuctions } from '../src/http/auctions';
import { mountControl } from '../src/http/control';
import {
  createJudgeRooms,
  JUDGE_CAPABILITIES_PATH,
  JUDGE_PAUSE_PATH,
  JUDGE_ROOMS_PATH,
  judgeRoomConfig,
  type JudgeRoomsOptions,
} from '../src/http/judge-rooms';
import { requestSources } from '../src/http/node-bridge';
import { Room, type RoomDeps } from '../src/room/room';
import { LedgerEngine } from '../src/runtime/ledger-engine';
import { MemoryStore } from '../src/store/memory-store';

const START = 1_789_000_000_000;
const ADMIN = 'fake-admin-key';
const SECRET = 'fake-secret-fake-secret-fake-0000';
const HOUR = 3_600_000;

const OPTS: JudgeRoomsOptions = {
  enabled: true,
  paused: false,
  maxLive: 3,
  ttlMs: 30 * 60_000,
  perIpPerHour: 2,
  globalPerHour: 5,
  maxCeilingCents: 5_000,
  lotWindowMs: 10 * 60_000,
};

interface Setup {
  app: HttpApp;
  clock: ManualClock;
  store: MemoryStore;
  rooms: ReturnType<typeof createJudgeRooms>;
  logs: { msg: string; fields: Record<string, unknown> }[];
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
  const logs: Setup['logs'] = [];
  const mkLog = (bound: Record<string, unknown>): Logger => ({
    debug: () => undefined,
    info: (msg, f) => void logs.push({ msg, fields: { ...bound, ...f } }),
    warn: (msg, f) => void logs.push({ msg, fields: { ...bound, ...f } }),
    error: (msg, f) => void logs.push({ msg, fields: { ...bound, ...f } }),
    child: (c) => mkLog({ ...bound, ...c }),
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
    log: mkLog({}),
  };
  const rooms = createJudgeRooms({ ...OPTS, ...over });
  const app = createHttpApp(deps, [mountAuctions, mountControl, rooms.mount]);
  return { app, clock, store, rooms, logs };
}

const post = (
  app: HttpApp,
  path: string,
  opts: { src?: string; body?: unknown; headers?: Record<string, string> } = {},
) => {
  const req = new Request(`http://h.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    body: JSON.stringify(opts.body ?? {}),
  });
  requestSources.set(req, opts.src ?? '203.0.113.7');
  return app.fetch(req);
};

interface Created {
  auctionId: string;
  joinCode: string;
  auctioneerToken: string;
  screenToken: string;
  auctioneerLink: string;
  expiresAt: number;
}
const created = async (res: Response): Promise<Created> => (await res.json()) as Created;

describe('judge rooms: flag guard', () => {
  it('answers 404 on create and reports false on the probe when the flag is off', async () => {
    const { app } = setup({ enabled: false });
    expect((await post(app, JUDGE_ROOMS_PATH)).status).toBe(404);
    const probe = await app.fetch(new Request(`http://h.test${JUDGE_CAPABILITIES_PATH}`));
    expect(await probe.json()).toEqual({ judgeRooms: false, accepting: false });
  });

  it('the probe returns booleans only', async () => {
    const { app } = setup();
    const body = (await (
      await app.fetch(new Request(`http://h.test${JUDGE_CAPABILITIES_PATH}`))
    ).json()) as Record<string, unknown>;
    expect(body).toEqual({ judgeRooms: true, accepting: true });
  });
});

describe('judge rooms: create', () => {
  it('creates a real room with safe defaults and no admin key', async () => {
    const { app, store, rooms } = setup();
    const res = await post(app, JUDGE_ROOMS_PATH);
    expect(res.status).toBe(201);
    const c = await created(res);
    expect(c.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(c.auctioneerLink).toContain(`/r/${c.auctionId}/console#token=`);
    expect(await store.lastSeq(c.auctionId as AuctionId)).toBeGreaterThan(0);
    expect(c.expiresAt).toBe(START + OPTS.ttlMs);
    expect(rooms.liveCount()).toBe(1);
    const read = await app.fetch(new Request(`http://h.test/api/auctions/${c.auctionId}`));
    expect(read.status).toBe(200);
  });

  it('keeps the lot config inside the cap', () => {
    const cfg = judgeRoomConfig(START, { lotWindowMs: 60_000, maxCeilingCents: 3_000 });
    expect(Math.max(...cfg.ceilingPresets)).toBeLessThanOrEqual(3_000);
    expect(cfg.endTs).toBe(START + 60_000);
    expect(cfg.maxExtensions).toBeLessThanOrEqual(2);
  });

  it('rejects unknown body fields', async () => {
    const { app } = setup();
    const res = await post(app, JUDGE_ROOMS_PATH, { body: { config: { reserve: 1 } } });
    expect(res.status).toBe(400);
  });

  it('marks audit entries as judge-room and keeps the raw address out of them', async () => {
    const { app, logs } = setup();
    await post(app, JUDGE_ROOMS_PATH, { src: '198.51.100.9' });
    const entry = logs.find((l) => l.fields.event === 'judge_room.created');
    expect(entry?.fields.judgeRoom).toBe(true);
    expect(entry?.fields.channel).toBe('judge-room');
    expect(JSON.stringify(logs)).not.toContain('198.51.100.9');
  });
});

describe('judge rooms: limits', () => {
  it('limits creates per source address and frees them after an hour', async () => {
    const { app, clock } = setup({ perIpPerHour: 2, maxLive: 10 });
    expect((await post(app, JUDGE_ROOMS_PATH, { src: '1.1.1.1' })).status).toBe(201);
    expect((await post(app, JUDGE_ROOMS_PATH, { src: '1.1.1.1' })).status).toBe(201);
    const third = await post(app, JUDGE_ROOMS_PATH, { src: '1.1.1.1' });
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).not.toBeNull();
    expect((await post(app, JUDGE_ROOMS_PATH, { src: '2.2.2.2' })).status).toBe(201);
    clock.set(clock.now() + (HOUR + 1));
    expect((await post(app, JUDGE_ROOMS_PATH, { src: '1.1.1.1' })).status).toBe(201);
  });

  it('limits creates for the whole host', async () => {
    const { app } = setup({ perIpPerHour: 10, globalPerHour: 3, maxLive: 10 });
    for (let i = 0; i < 3; i++) {
      expect((await post(app, JUDGE_ROOMS_PATH, { src: `9.9.9.${String(i)}` })).status).toBe(201);
    }
    const res = await post(app, JUDGE_ROOMS_PATH, { src: '9.9.9.200' });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe('judge_rate_limited');
  });

  it('caps concurrent rooms and a burst cannot overshoot it', async () => {
    const { app, rooms } = setup({ maxLive: 2, perIpPerHour: 50, globalPerHour: 50 });
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => post(app, JUDGE_ROOMS_PATH, { src: `7.7.7.${String(i)}` })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 429)).toHaveLength(3);
    expect(rooms.liveCount()).toBe(2);
    const probe = await app.fetch(new Request(`http://h.test${JUDGE_CAPABILITIES_PATH}`));
    expect(await probe.json()).toEqual({ judgeRooms: true, accepting: false });
  });
});

describe('judge rooms: kill switch', () => {
  it('needs the admin key to flip, then refuses creates until resumed', async () => {
    const { app } = setup();
    const body = { paused: true };
    expect((await post(app, JUDGE_PAUSE_PATH, { body })).status).toBe(401);
    const headers = { 'x-admin-key': ADMIN };
    expect((await post(app, JUDGE_PAUSE_PATH, { body, headers })).status).toBe(200);
    const blocked = await post(app, JUDGE_ROOMS_PATH);
    expect(blocked.status).toBe(503);
    await post(app, JUDGE_PAUSE_PATH, { body: { paused: false }, headers });
    expect((await post(app, JUDGE_ROOMS_PATH)).status).toBe(201);
  });

  it('starts paused when the boot option says so', async () => {
    const { app } = setup({ paused: true });
    expect((await post(app, JUDGE_ROOMS_PATH)).status).toBe(503);
  });
});

describe('judge rooms: expiry and cleanup', () => {
  it('ends a room past its lifetime, kills its token and frees the slot', async () => {
    const { app, clock, rooms, store } = setup({ maxLive: 1 });
    const c = await created(await post(app, JUDGE_ROOMS_PATH));
    const control = (token: string) =>
      app.fetch(
        new Request(`http://h.test/api/auctions/${c.auctionId}/kill`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ confirm: 'STOP' }),
        }),
      );
    expect((await post(app, JUDGE_ROOMS_PATH, { src: '5.5.5.5' })).status).toBe(429);
    clock.set(clock.now() + (OPTS.ttlMs + 1));
    expect(await rooms.sweep()).toBe(1);
    expect(rooms.liveCount()).toBe(0);
    expect((await control(c.auctioneerToken)).status).toBe(401);
    const marker = await store.getJournal(`judge:room:${c.auctionId}`);
    expect((marker?.value as { expired?: boolean }).expired).toBe(true);
    expect((await post(app, JUDGE_ROOMS_PATH, { src: '5.5.5.5' })).status).toBe(201);
  });

  it('does not touch a room that is still inside its lifetime', async () => {
    const { app, clock, rooms } = setup();
    await post(app, JUDGE_ROOMS_PATH);
    clock.set(clock.now() + 60_000);
    expect(await rooms.sweep()).toBe(0);
    expect(rooms.liveCount()).toBe(1);
  });
});

describe('judge rooms: token scoping', () => {
  it('the auctioneer token opens no admin route and only works in its own room', async () => {
    const { app } = setup({ perIpPerHour: 10 });
    const a = await created(await post(app, JUDGE_ROOMS_PATH));
    const b = await created(await post(app, JUDGE_ROOMS_PATH));
    const bearer = { authorization: `Bearer ${a.auctioneerToken}` };
    // Admin create and the pause switch want the operator key, not a room token.
    const adminCreate = await post(app, '/api/auctions', { headers: bearer, body: {} });
    expect(adminCreate.status).toBe(401);
    expect(
      (await post(app, JUDGE_PAUSE_PATH, { headers: bearer, body: { paused: true } })).status,
    ).toBe(401);
    // Another room rejects it.
    const other = await post(app, `/api/auctions/${b.auctionId}/kill`, {
      headers: bearer,
      body: { confirm: 'STOP' },
    });
    expect(other.status).toBe(401);
    // Its own room accepts it.
    const own = await post(app, `/api/auctions/${a.auctionId}/kill`, {
      headers: bearer,
      body: { confirm: 'STOP' },
    });
    expect(own.status).toBe(200);
  });
});
