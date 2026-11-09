import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type AuctionId,
  type Logger,
} from '@gavel/shared';
import {
  genesisHead,
  InMemoryLedgerStore,
  sealBatch,
  type LedgerEvent,
  type Ulid,
} from '@gavel/engine';
import { isReplayBundle } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { secretSetFromConfig } from '../src/auth/rotation';
import { createHttpApp, type HttpApp, type HttpDeps } from '../src/http/app';
import { mountAuctions } from '../src/http/auctions';
import { mountControl } from '../src/http/control';
import { mountRead } from '../src/http/read';
import {
  createJudgeRooms,
  JUDGE_CAPABILITIES_PATH,
  JUDGE_KEY_HEADER,
  JUDGE_KEY_PATH,
  JUDGE_PAUSE_PATH,
  JUDGE_JOIN_PATH,
  JUDGE_ROOMS_PATH,
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
// Test-only constants, built at run time, not used anywhere else.
const JUDGE = ['test', 'judge', 'k'.repeat(32)].join('-');
const WRONG = ['test', 'wrong', 'w'.repeat(32)].join('-');

const OPTS: JudgeRoomsOptions = {
  enabled: true,
  paused: false,
  maxLive: 3,
  ttlMs: 30 * 60_000,
  perIpPerHour: 2,
  globalPerHour: 5,
  maxCeilingCents: 5_000,
  lotWindowMs: 10 * 60_000,
  judgeKey: JUDGE,
  keyedMax: 3,
};

interface Setup {
  app: HttpApp;
  clock: ManualClock;
  store: MemoryStore;
  ledger: InMemoryLedgerStore;
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
  const ledger = new InMemoryLedgerStore();
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
  const rooms = createJudgeRooms({ ...OPTS, ledger, ...over });
  const app = createHttpApp(deps, [mountAuctions, mountControl, mountRead, rooms.mount]);
  return { app, clock, store, ledger, rooms, logs };
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
  reviewerToken: string;
  reviewerLink: string;
  screenToken: string;
  unlocked?: true;
}
const created = async (res: Response): Promise<Created> => (await res.json()) as Created;
const keyed = (key: string = JUDGE) => ({ [JUDGE_KEY_HEADER]: key });
const get = (app: HttpApp, path: string, token?: string) =>
  app.fetch(
    new Request(`http://h.test${path}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    }),
  );

describe('judge key: probe', () => {
  it('says keyed only when a key is set', async () => {
    const on = setup();
    expect(await (await get(on.app, JUDGE_CAPABILITIES_PATH)).json()).toMatchObject({
      keyed: true,
    });
    const off = setup({ judgeKey: undefined });
    expect(await (await get(off.app, JUDGE_CAPABILITIES_PATH)).json()).not.toHaveProperty('keyed');
  });
});

describe('judge key: create', () => {
  it('lifts the per-address limit and the public cap, within its own bound', async () => {
    const { app, rooms } = setup({ perIpPerHour: 1, maxLive: 1, keyedMax: 3 });
    // The public path is full after one room.
    expect((await post(app, JUDGE_ROOMS_PATH, { src: '1.1.1.1' })).status).toBe(201);
    expect((await post(app, JUDGE_ROOMS_PATH, { src: '1.1.1.1' })).status).toBe(429);
    for (let i = 0; i < 3; i++) {
      const res = await post(app, JUDGE_ROOMS_PATH, { src: '1.1.1.1', headers: keyed() });
      expect(res.status).toBe(201);
      expect((await created(res)).unlocked).toBe(true);
    }
    const fourth = await post(app, JUDGE_ROOMS_PATH, { src: '1.1.1.1', headers: keyed() });
    expect(fourth.status).toBe(429);
    expect(((await fourth.json()) as { error: string }).error).toBe('judge_key_room_cap');
    expect(rooms.liveCount()).toBe(4);
    // Keyed rooms do not use a public slot.
    const probe = (await (await get(app, JUDGE_CAPABILITIES_PATH)).json()) as {
      accepting: boolean;
    };
    expect(probe.accepting).toBe(false);
  });

  it('frees a keyed slot when the room expires', async () => {
    const { app, clock, rooms } = setup({ keyedMax: 1 });
    expect((await post(app, JUDGE_ROOMS_PATH, { headers: keyed() })).status).toBe(201);
    expect((await post(app, JUDGE_ROOMS_PATH, { headers: keyed() })).status).toBe(429);
    clock.set(clock.now() + OPTS.ttlMs + 1);
    await rooms.sweep();
    expect((await post(app, JUDGE_ROOMS_PATH, { headers: keyed() })).status).toBe(201);
  });

  it('a burst of keyed creates cannot overshoot the bound', async () => {
    const { app, rooms } = setup({ keyedMax: 2 });
    const all = await Promise.all(
      Array.from({ length: 8 }, () => post(app, JUDGE_ROOMS_PATH, { headers: keyed() })),
    );
    expect(all.filter((r) => r.status === 201)).toHaveLength(2);
    expect(rooms.liveCount()).toBe(2);
  });

  it('bounds keyed creates per hour as well', async () => {
    const { app, clock, rooms } = setup({ keyedMax: 10, ttlMs: 60_000 });
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 10; i++) {
        expect((await post(app, JUDGE_ROOMS_PATH, { headers: keyed() })).status).toBe(201);
      }
      clock.set(clock.now() + 61_000);
      await rooms.sweep();
    }
    const over = await post(app, JUDGE_ROOMS_PATH, { headers: keyed() });
    expect(over.status).toBe(429);
    expect(((await over.json()) as { error: string }).error).toBe('judge_rate_limited');
    clock.set(clock.now() + HOUR);
    expect((await post(app, JUDGE_ROOMS_PATH, { headers: keyed() })).status).toBe(201);
  });

  it('still honours the kill switch', async () => {
    const { app } = setup({ paused: true });
    const res = await post(app, JUDGE_ROOMS_PATH, { headers: keyed() });
    expect(res.status).toBe(503);
  });
});

describe('judge key: wrong key', () => {
  it('answers 401, creates nothing and never falls back to the public path', async () => {
    const { app, rooms } = setup();
    const res = await post(app, JUDGE_ROOMS_PATH, { headers: keyed(WRONG) });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('judge_key_invalid');
    expect(rooms.liveCount()).toBe(0);
  });

  it('refuses an empty key and a key sent while none is set', async () => {
    const { app } = setup();
    expect((await post(app, JUDGE_ROOMS_PATH, { headers: keyed('') })).status).toBe(401);
    const off = setup({ judgeKey: undefined });
    expect((await post(off.app, JUDGE_ROOMS_PATH, { headers: keyed(JUDGE) })).status).toBe(401);
  });

  it('locks the key check after five wrong keys, even for the right key', async () => {
    const { app, clock } = setup();
    for (let i = 0; i < 5; i++) {
      expect(
        (await post(app, JUDGE_KEY_PATH, { src: '4.4.4.4', headers: keyed(WRONG) })).status,
      ).toBe(401);
    }
    const locked = await post(app, JUDGE_KEY_PATH, { src: '4.4.4.4', headers: keyed() });
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).not.toBeNull();
    const create = await post(app, JUDGE_ROOMS_PATH, { src: '4.4.4.4', headers: keyed() });
    expect(create.status).toBe(429);
    // Another address is not affected, and the lockout ends.
    expect((await post(app, JUDGE_KEY_PATH, { src: '5.5.5.5', headers: keyed() })).status).toBe(
      200,
    );
    clock.set(clock.now() + 15 * 60_000 + 1);
    expect((await post(app, JUDGE_KEY_PATH, { src: '4.4.4.4', headers: keyed() })).status).toBe(
      200,
    );
  });

  it('keeps key strikes and room code strikes apart (#2234)', async () => {
    const { app } = setup();
    // Five wrong keys lock the key check only: joins and lookups from that address still work.
    for (let i = 0; i < 5; i++) {
      await post(app, JUDGE_KEY_PATH, { src: '6.6.6.6', headers: keyed(WRONG) });
    }
    expect((await post(app, JUDGE_KEY_PATH, { src: '6.6.6.6', headers: keyed() })).status).toBe(
      429,
    );
    const room = await created(await post(app, JUDGE_ROOMS_PATH, { src: '7.7.7.7' }));
    const join = await post(app, JUDGE_JOIN_PATH, {
      src: '6.6.6.6',
      body: { code: room.joinCode, displayName: 'A' },
    });
    expect(join.status).toBe(200);
    const lookupReq = new Request(`http://h.test/api/auctions/${room.joinCode}`);
    requestSources.set(lookupReq, '6.6.6.6');
    const lookup = await app.fetch(lookupReq);
    expect(lookup.status).toBe(200);
    // And five wrong room codes lock the codes only: the right key still passes.
    for (let i = 0; i < 5; i++) {
      await post(app, JUDGE_JOIN_PATH, {
        src: '8.8.8.8',
        body: { code: 'ZZZZZZ', displayName: 'A' },
      });
    }
    const codeLocked = await post(app, JUDGE_JOIN_PATH, {
      src: '8.8.8.8',
      body: { code: room.joinCode, displayName: 'A' },
    });
    expect(codeLocked.status).toBe(429);
    expect((await post(app, JUDGE_KEY_PATH, { src: '8.8.8.8', headers: keyed() })).status).toBe(
      200,
    );
  });
});

describe('judge key: key check route', () => {
  it('accepts the right key and reports the bound', async () => {
    const { app } = setup();
    const res = await post(app, JUDGE_KEY_PATH, { headers: keyed() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, roomsMax: 3, roomsLive: 0 });
  });

  it('answers 404 while judge rooms are off', async () => {
    const { app } = setup({ enabled: false });
    expect((await post(app, JUDGE_KEY_PATH, { headers: keyed() })).status).toBe(404);
  });
});

describe('judge key: audit trail without the key', () => {
  it('records keyed actions and refusals and never holds a key or an address', async () => {
    const { app, logs } = setup();
    await post(app, JUDGE_KEY_PATH, { src: '7.7.7.7', headers: keyed() });
    await post(app, JUDGE_ROOMS_PATH, { src: '7.7.7.7', headers: keyed() });
    await post(app, JUDGE_ROOMS_PATH, { src: '7.7.7.7', headers: keyed(WRONG) });
    const events = logs.map((l) => l.fields.event);
    expect(events).toContain('judge_room.key_ok');
    expect(events).toContain('judge_room.created');
    expect(logs.find((l) => l.fields.event === 'judge_room.created')?.fields.via).toBe(
      'judge-pass',
    );
    expect(logs.find((l) => l.fields.reason === 'key_wrong')?.fields.event).toBe(
      'judge_room.refused',
    );
    const text = JSON.stringify(logs);
    expect(text).not.toContain(JUDGE);
    expect(text).not.toContain(WRONG);
    expect(text).not.toContain('7.7.7.7');
  });
});

describe('reviewer link', () => {
  it('every judge room gets a reviewer token that only reads', async () => {
    const { app } = setup();
    const c = await created(await post(app, JUDGE_ROOMS_PATH));
    expect(c.reviewerLink).toContain(`/r/${c.auctionId}/audit#token=${c.reviewerToken}`);
    const snap = await get(app, `/api/auctions/${c.auctionId}/snapshot`, c.reviewerToken);
    expect(snap.status).toBe(200);
    const events = await get(app, `/api/auctions/${c.auctionId}/events`, c.reviewerToken);
    expect(events.status).toBe(200);
    // It cannot drive the room or read another room.
    const ctl = await app.fetch(
      new Request(`http://h.test/api/auctions/${c.auctionId}/control`, {
        method: 'POST',
        headers: { authorization: `Bearer ${c.reviewerToken}`, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect([401, 403]).toContain(ctl.status);
    const other = await created(await post(app, JUDGE_ROOMS_PATH, { src: '8.8.8.8' }));
    const cross = await get(app, `/api/auctions/${other.auctionId}/snapshot`, c.reviewerToken);
    expect(cross.status).toBe(401);
  });

  it('reads the verified ledger of a judge room, and only of a judge room', async () => {
    const { app, ledger } = setup();
    const c = await created(await post(app, JUDGE_ROOMS_PATH));
    const path = `/api/judge/rooms/${c.auctionId}/ledger`;
    expect((await get(app, path, c.reviewerToken)).status).toBe(404);
    const id = c.auctionId as Ulid;
    const events = [
      { type: 'AUCTION_CREATED', payload: { note: 'x' } },
      { type: 'AUCTION_CLOSED', payload: { headHash: 'h' } },
    ] as unknown as LedgerEvent[];
    await ledger.append(id, sealBatch(events, genesisHead(id), 1000, null), 0);
    const ok = await get(app, path, c.reviewerToken);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(isReplayBundle(await ok.json())).toBe(true);
    expect((await get(app, path)).status).toBe(401);
    expect((await get(app, path, 'garbage')).status).toBe(401);
    // Not a judge room: same answer as no such room.
    const plain = await get(app, `/api/judge/rooms/${'0'.repeat(26)}/ledger`, c.reviewerToken);
    expect([401, 404]).toContain(plain.status);
  });

  it('refuses session and screen tokens on the ledger route, allows reviewer', async () => {
    const { app, ledger } = setup();
    const c = await created(await post(app, JUDGE_ROOMS_PATH));
    const id = c.auctionId as Ulid;
    const events = [
      { type: 'AUCTION_CREATED', payload: { note: 'x' } },
    ] as unknown as LedgerEvent[];
    await ledger.append(id, sealBatch(events, genesisHead(id), 1000, null), 0);
    const path = `/api/judge/rooms/${c.auctionId}/ledger`;
    const joined = await post(app, JUDGE_JOIN_PATH, {
      body: { code: c.joinCode, displayName: 'Ada' },
    });
    expect(joined.status).toBe(200);
    const { sessionToken } = (await joined.json()) as { sessionToken: string };
    expect([401, 403]).toContain((await get(app, path, sessionToken)).status);
    expect([401, 403]).toContain((await get(app, path, c.screenToken)).status);
    expect((await get(app, path, c.reviewerToken)).status).toBe(200);
  });

  it('answers 404 when the host passes no ledger', async () => {
    const { app } = setup({ ledger: undefined });
    const c = await created(await post(app, JUDGE_ROOMS_PATH));
    expect((await get(app, `/api/judge/rooms/${c.auctionId}/ledger`, c.reviewerToken)).status).toBe(
      404,
    );
  });
});

describe('judge key: pause route still needs the operator key', () => {
  it('does not accept the judge key as the operator key', async () => {
    const { app } = setup();
    const res = await post(app, JUDGE_PAUSE_PATH, {
      body: { paused: true },
      headers: { 'x-admin-key': JUDGE },
    });
    expect(res.status).toBe(401);
  });
});
