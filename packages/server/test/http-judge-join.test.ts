import {
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
  JUDGE_JOIN_DEFAULTS,
  JUDGE_JOIN_PATH,
  JUDGE_ROOMS_PATH,
  JUDGE_SIM_HOLD_PATH,
  judgeRoomConfig,
  type JudgeRoomsOptions,
  type SimHolds,
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

interface Joined {
  auctionId: string;
  sessionToken: string;
  bidderId: string;
  displayName: string;
  wsUrl: string;
}

const claimsOf = (token: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;

const join = (app: HttpApp, body: unknown, src = '198.51.100.1'): Promise<Response> =>
  post(app, JUDGE_JOIN_PATH, { src, body });

describe('judge open join (SRV-30): success', () => {
  it('returns a session token like an invite join does', async () => {
    const { app } = setup();
    const room = await createRoom(app);
    const res = await join(app, { code: room.joinCode, displayName: 'Ada' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Joined;
    expect(body.auctionId).toBe(room.auctionId);
    expect(body.displayName).toBe('Ada');
    expect(body.wsUrl).toBe('wss://gavel.example.test/ws');
    const claims = claimsOf(body.sessionToken);
    expect(claims.kind).toBe('session');
    expect(claims.aud).toBe(room.auctionId);
    expect(claims.sub).toBe(body.bidderId);
    expect(claims.bidderId).toBe(body.bidderId);
  });

  it('accepts the code in lower case and gives each join its own bidder id', async () => {
    const { app } = setup();
    const room = await createRoom(app);
    const a = (await (
      await join(app, { code: room.joinCode.toLowerCase(), displayName: 'A' })
    ).json()) as Joined;
    const b = (await (await join(app, { code: room.joinCode, displayName: 'B' })).json()) as Joined;
    expect(a.bidderId).not.toBe(b.bidderId);
  });

  it('refuses a bad display name and unknown fields', async () => {
    const { app } = setup();
    const room = await createRoom(app);
    expect((await join(app, { code: room.joinCode, displayName: '' })).status).toBe(400);
    expect((await join(app, { code: room.joinCode, displayName: 'a<b>' })).status).toBe(400);
    expect((await join(app, { code: room.joinCode, displayName: 'x'.repeat(65) })).status).toBe(
      400,
    );
    expect((await join(app, { code: room.joinCode, displayName: 'Ada', extra: 1 })).status).toBe(
      400,
    );
  });
});

describe('judge open join (SRV-30): refusals', () => {
  it('answers 404 for a wrong code', async () => {
    const { app } = setup();
    await createRoom(app);
    const res = await join(app, { code: 'ZZZZZZ', displayName: 'Ada' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('not_found');
  });

  it('never opens a normal auction, and answers like a wrong code', async () => {
    const { app, clock } = setup();
    const normal = await createNormal(app, clock);
    const res = await join(app, { code: normal.joinCode, displayName: 'Ada' });
    expect(res.status).toBe(404);
    const wrong = await join(app, { code: 'ZZZZZZ', displayName: 'Ada' }, '198.51.100.2');
    expect(await res.text()).toBe(await wrong.text());
  });

  it('answers 404 when JUDGE_ROOMS is off', async () => {
    const { app } = setup({ enabled: false });
    const res = await join(app, { code: 'ABCDEF', displayName: 'Ada' });
    expect(res.status).toBe(404);
  });

  it('answers 410 once the room is past its lifetime', async () => {
    const { app, clock } = setup();
    const room = await createRoom(app);
    clock.set(clock.now() + OPTS.ttlMs + 1);
    const res = await join(app, { code: room.joinCode, displayName: 'Ada' });
    expect(res.status).toBe(410);
    expect(((await res.json()) as { error: string }).error).toBe('judge_room_expired');
  });

  it('answers 410 for a room the sweeper already ended', async () => {
    const { app, clock, rooms } = setup();
    const room = await createRoom(app);
    clock.set(clock.now() + OPTS.ttlMs + 1);
    await rooms.sweep();
    const res = await join(app, { code: room.joinCode, displayName: 'Ada' });
    expect(res.status).toBe(410);
  });

  it('stops at the bidder cap per room', async () => {
    const { app } = setup({ join: { maxBiddersPerRoom: 2, attemptsPerIpPerMin: 100 } });
    const room = await createRoom(app);
    expect((await join(app, { code: room.joinCode, displayName: 'A' })).status).toBe(200);
    expect((await join(app, { code: room.joinCode, displayName: 'B' })).status).toBe(200);
    const third = await join(app, { code: room.joinCode, displayName: 'C' });
    expect(third.status).toBe(429);
    expect(((await third.json()) as { error: string }).error).toBe('judge_room_full');
  });

  it('gives back the seats of sessions that never took a hold, keeps those that did (#2082)', async () => {
    const sim: SimHolds = {
      acceptsHolds: () => Promise.resolve(true),
      place: (i) => Promise.resolve(`sim-hold-${i.bidderId}`),
    };
    const { app, clock } = setup({
      simHolds: sim,
      join: { maxBiddersPerRoom: 3, attemptsPerIpPerMin: 100 },
    });
    const room = await createRoom(app);
    const a = (await (await join(app, { code: room.joinCode, displayName: 'A' })).json()) as Joined;
    await join(app, { code: room.joinCode, displayName: 'B' });
    await join(app, { code: room.joinCode, displayName: 'C' });
    const hold = await post(app, JUDGE_SIM_HOLD_PATH.replace(':id', room.auctionId), {
      body: { ceilingCents: 5_000, name: 'A' },
      headers: { authorization: `Bearer ${a.sessionToken}` },
    });
    expect(hold.status).toBe(200);
    expect((await join(app, { code: room.joinCode, displayName: 'D' })).status).toBe(429);
    // Two minutes on, B and C (no hold) are gone; A (holds) keeps its seat.
    clock.set(clock.now() + 2 * 60_000 + 1);
    expect((await join(app, { code: room.joinCode, displayName: 'D' })).status).toBe(200);
    expect((await join(app, { code: room.joinCode, displayName: 'E' })).status).toBe(200);
    expect((await join(app, { code: room.joinCode, displayName: 'F' })).status).toBe(429);
  });

  it('a burst of joins cannot overshoot the cap', async () => {
    const { app } = setup({ join: { maxBiddersPerRoom: 3, attemptsPerIpPerMin: 100 } });
    const room = await createRoom(app);
    const results = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((i) => join(app, { code: room.joinCode, displayName: `P${i}` })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
  });
});

describe('judge open join (SRV-30): rate limit and lockout', () => {
  it('limits attempts per source address and frees them after a minute', async () => {
    const { app, clock } = setup({
      join: { attemptsPerIpPerMin: 3, wrongCodesBeforeLockout: 100 },
    });
    const room = await createRoom(app);
    for (let i = 0; i < 3; i++) {
      expect((await join(app, { code: room.joinCode, displayName: 'A' }, '5.5.5.5')).status).toBe(
        200,
      );
    }
    const limited = await join(app, { code: room.joinCode, displayName: 'A' }, '5.5.5.5');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
    expect((await join(app, { code: room.joinCode, displayName: 'A' }, '6.6.6.6')).status).toBe(
      200,
    );
    clock.set(clock.now() + 60_001);
    expect((await join(app, { code: room.joinCode, displayName: 'A' }, '5.5.5.5')).status).toBe(
      200,
    );
  });

  it('locks an address out after N wrong codes, even for the right code', async () => {
    const { app, clock } = setup();
    const room = await createRoom(app);
    const n = JUDGE_JOIN_DEFAULTS.wrongCodesBeforeLockout;
    for (let i = 0; i < n; i++) {
      const res = await join(app, { code: 'ZZZZZZ', displayName: 'X' }, '7.7.7.7');
      expect(res.status).toBe(404);
      // Stay under the per-minute attempt limit while the wrong codes pile up.
      clock.set(clock.now() + 7_000);
    }
    const locked = await join(app, { code: room.joinCode, displayName: 'X' }, '7.7.7.7');
    expect(locked.status).toBe(429);
    expect(((await locked.json()) as { error: string }).error).toBe('judge_join_locked');
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another address is not affected.
    expect((await join(app, { code: room.joinCode, displayName: 'Y' }, '8.8.8.8')).status).toBe(
      200,
    );
    // The lockout ends.
    clock.set(clock.now() + JUDGE_JOIN_DEFAULTS.lockoutMs + 1);
    expect((await join(app, { code: room.joinCode, displayName: 'X' }, '7.7.7.7')).status).toBe(
      200,
    );
  });

  it('counts the code of a normal auction as a wrong code', async () => {
    const { app, clock } = setup({ join: { wrongCodesBeforeLockout: 2 } });
    const normal = await createNormal(app, clock);
    const room = await createRoom(app);
    await join(app, { code: normal.joinCode, displayName: 'X' }, '4.4.4.4');
    await join(app, { code: normal.joinCode, displayName: 'X' }, '4.4.4.4');
    const res = await join(app, { code: room.joinCode, displayName: 'X' }, '4.4.4.4');
    expect(res.status).toBe(429);
  });
});
