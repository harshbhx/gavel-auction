import { ManualClock, SeqIds, type AuctionConfig, type AuctionId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { secretSetFromConfig } from '../src/auth/rotation';
import { createHttpApp, type HttpApp, type HttpDeps } from '../src/http/app';
import { mountAuctions, normalizeJoinCode } from '../src/http/auctions';
import { mountControl } from '../src/http/control';
import {
  createJudgeRooms,
  JUDGE_JOIN_DEFAULTS,
  JUDGE_JOIN_PATH,
  JUDGE_ROOM_DEFAULTS,
  JUDGE_ROOMS_PATH,
  type JudgeRoomsOptions,
} from '../src/http/judge-rooms';
import { webOriginOf } from '../src/boot/compose';
import { parseConfig } from '../src/config';
import { requestSources } from '../src/http/node-bridge';
import { Room, type RoomDeps } from '../src/room/room';
import { LedgerEngine } from '../src/runtime/ledger-engine';
import { MemoryStore } from '../src/store/memory-store';

const START = 1_789_000_000_000;
const ADMIN = 'fake-admin-key-fake-admin-key';
const SECRET = 'fake-secret-fake-secret-fake-0000';
const API = 'https://api.example.test';
const WEB = 'https://web.example.test';

const OPTS: JudgeRoomsOptions = {
  enabled: true,
  paused: false,
  maxLive: 10,
  ttlMs: 30 * 60_000,
  perIpPerHour: 100,
  globalPerHour: 100,
  maxCeilingCents: 5_000,
  lotWindowMs: 10 * 60_000,
};

function setup(over: Partial<JudgeRoomsOptions> = {}, webOrigin: string | null = WEB) {
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
    publicUrl: API,
    ...(webOrigin === null ? {} : { webOrigin }),
    corsOrigins: [],
  };
  const rooms = createJudgeRooms({ ...OPTS, ...over });
  const app = createHttpApp(deps, [mountAuctions, mountControl, rooms.mount]);
  return { app, clock, rooms };
}

type Setup = ReturnType<typeof setup>;

const call = (
  app: HttpApp,
  method: 'GET' | 'POST',
  path: string,
  opts: { src?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> => {
  const req = new Request(`http://h.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    ...(method === 'POST' ? { body: JSON.stringify(opts.body ?? {}) } : {}),
  });
  requestSources.set(req, opts.src ?? '203.0.113.7');
  return app.fetch(req);
};

interface Created {
  auctionId: string;
  joinCode: string;
  auctioneerToken: string;
  auctioneerLink: string;
  screenLink: string;
}

const createRoom = async (s: Setup, src = '10.0.0.1'): Promise<Created> => {
  const res = await call(s.app, 'POST', JUDGE_ROOMS_PATH, { src });
  expect(res.status).toBe(201);
  return (await res.json()) as Created;
};

const join = (s: Setup, code: string, src = '198.51.100.1'): Promise<Response> =>
  call(s.app, 'POST', JUDGE_JOIN_PATH, { src, body: { code, displayName: 'Ada' } });

const control = (s: Setup, room: Created, body: unknown): Promise<Response> =>
  call(s.app, 'POST', `/api/auctions/${room.auctionId}/control`, {
    headers: { authorization: `Bearer ${room.auctioneerToken}` },
    body,
  });

const bodyOf = async (res: Response): Promise<Record<string, unknown>> =>
  (await res.json()) as Record<string, unknown>;

describe('SRV-35 A: a hammered room takes no joins and frees its slot', () => {
  const hammer = { controlId: 'h1', action: 'hammer', args: { closeNow: 1 } };

  it('refuses a join after the hammer with 410 and a clear message', async () => {
    const s = setup();
    const room = await createRoom(s);
    expect((await join(s, room.joinCode)).status).toBe(200);
    expect((await control(s, room, hammer)).status).toBe(200);
    const res = await join(s, room.joinCode, '198.51.100.9');
    expect(res.status).toBe(410);
    expect(await bodyOf(res)).toMatchObject({
      error: 'judge_room_ended',
      message: 'That room has ended',
    });
  });

  it('gives the slot back at the hammer, before the sweeper runs', async () => {
    const s = setup({ maxLive: 1 });
    const room = await createRoom(s);
    const full = await call(s.app, 'POST', JUDGE_ROOMS_PATH, { src: '10.0.0.2' });
    expect(full.status).toBe(429);
    expect(await bodyOf(full)).toMatchObject({ error: 'judge_room_cap' });
    const caps = await call(s.app, 'GET', '/api/judge/capabilities');
    expect(await bodyOf(caps)).toMatchObject({ accepting: false });

    expect((await control(s, room, hammer)).status).toBe(200);
    // No sweep() call: the capabilities probe and the next create notice the ended room.
    const caps2 = await call(s.app, 'GET', '/api/judge/capabilities');
    expect(await bodyOf(caps2)).toMatchObject({ accepting: true });
    expect(s.rooms.liveCount()).toBe(0);
    const again = await call(s.app, 'POST', JUDGE_ROOMS_PATH, { src: '10.0.0.3' });
    expect(again.status).toBe(201);
  });

  it('a create frees the slot of a hammered room by itself', async () => {
    const s = setup({ maxLive: 1 });
    const room = await createRoom(s);
    await control(s, room, hammer);
    const again = await call(s.app, 'POST', JUDGE_ROOMS_PATH, { src: '10.0.0.4' });
    expect(again.status).toBe(201);
  });

  it('allows more than five rooms by default, within a safe upper bound', () => {
    expect(JUDGE_ROOM_DEFAULTS.maxLive).toBeGreaterThanOrEqual(10);
    const r = parseConfig({
      PUBLIC_URL: 'http://localhost:8080',
      TOKEN_SECRET: 'fake-secret-fake-secret-fake-0000',
      ADMIN_KEY: 'fake-admin-key-fake-admin-key',
    });
    expect(r.ok && r.config.JUDGE_ROOMS_MAX).toBe(JUDGE_ROOM_DEFAULTS.maxLive);
    const tooMany = parseConfig({
      PUBLIC_URL: 'http://localhost:8080',
      TOKEN_SECRET: 'fake-secret-fake-secret-fake-0000',
      ADMIN_KEY: 'fake-admin-key-fake-admin-key',
      JUDGE_ROOMS_MAX: '51',
    });
    expect(tooMany.ok).toBe(false);
  });
});

describe('SRV-35 B: links point at the web app', () => {
  it('builds judge room links on the web origin, not the API host', async () => {
    const room = await createRoom(setup());
    expect(room.auctioneerLink.startsWith(`${WEB}/r/${room.auctionId}/console#token=`)).toBe(true);
    expect(room.screenLink.startsWith(`${WEB}/r/${room.auctionId}/screen#token=`)).toBe(true);
  });

  it('builds operator auction, invite and receipt links on the web origin', async () => {
    const s = setup();
    const made = await call(s.app, 'POST', '/api/auctions', {
      headers: { 'x-admin-key': ADMIN },
      body: {
        title: 'Lot',
        config: {
          mode: 'english',
          currency: 'USD',
          reserve: 1000,
          minIncrement: 500,
          endTs: START + 600_000,
          softCloseWindowMs: 15_000,
          softCloseExtensionMs: 15_000,
          maxExtensions: 2,
          ceilingPresets: [2000, 5000],
          confirmConfidenceThreshold: 0.85,
        },
      },
    });
    expect(made.status).toBe(201);
    const b = (await made.json()) as { auctioneerLink: string; screenLink: string };
    expect(b.auctioneerLink.startsWith(`${WEB}/r/`)).toBe(true);
    expect(b.screenLink.startsWith(`${WEB}/r/`)).toBe(true);
  });

  it('falls back to the API host when no web origin is set', async () => {
    const room = await createRoom(setup({}, null));
    expect(room.auctioneerLink.startsWith(`${API}/r/`)).toBe(true);
  });

  it('picks WEB_ORIGIN, then the first CORS origin, then PUBLIC_URL', () => {
    const base = { PUBLIC_URL: `${API}/`, CORS_ORIGINS: [] as string[] };
    expect(webOriginOf({ ...base, WEB_ORIGIN: WEB })).toBe(WEB);
    expect(webOriginOf({ ...base, CORS_ORIGINS: ['https://cors.example.test', WEB] })).toBe(
      'https://cors.example.test',
    );
    expect(webOriginOf({ ...base, WEB_ORIGIN: WEB, CORS_ORIGINS: ['https://c.test'] })).toBe(WEB);
    expect(webOriginOf(base)).toBe(API);
  });

  it('reads WEB_ORIGIN from the environment and drops any path', () => {
    const r = parseConfig({
      PUBLIC_URL: 'http://localhost:8080',
      TOKEN_SECRET: 'fake-secret-fake-secret-fake-0000',
      ADMIN_KEY: 'fake-admin-key-fake-admin-key',
      WEB_ORIGIN: `${WEB}/some/path/`,
    });
    expect(r.ok && r.config.WEB_ORIGIN).toBe(WEB);
    const bad = parseConfig({
      PUBLIC_URL: 'http://localhost:8080',
      TOKEN_SECRET: 'fake-secret-fake-secret-fake-0000',
      ADMIN_KEY: 'fake-admin-key-fake-admin-key',
      WEB_ORIGIN: 'not a url',
    });
    expect(bad.ok).toBe(false);
  });
});

describe('SRV-35 C: judge errors always carry error and message', () => {
  it('wrong code, ended, full, locked, rate limited, cap and bad body', async () => {
    const s = setup({ maxLive: 2, join: { maxBiddersPerRoom: 1, attemptsPerIpPerMin: 4 } });
    const room = await createRoom(s);

    const wrong = await join(s, 'ZZZZZZ', '1.1.1.1');
    expect(wrong.status).toBe(404);
    expect(await bodyOf(wrong)).toEqual({
      error: 'not_found',
      message: 'Code not found, check and try again',
    });

    expect((await join(s, room.joinCode, '2.2.2.2')).status).toBe(200);
    const full = await join(s, room.joinCode, '2.2.2.3');
    expect(full.status).toBe(429);
    expect(await bodyOf(full)).toEqual({ error: 'judge_room_full', message: 'Room is full' });

    const bad = await call(s.app, 'POST', JUDGE_JOIN_PATH, { src: '3.3.3.3', body: { nope: 1 } });
    expect(bad.status).toBe(400);
    const badBody = await bodyOf(bad);
    expect(badBody.error).toBe('bad_message');
    expect(typeof badBody.message).toBe('string');

    for (let i = 0; i < 4; i++) await join(s, room.joinCode, '4.4.4.4');
    const limited = await join(s, room.joinCode, '4.4.4.4');
    expect(limited.status).toBe(429);
    const limitedBody = await bodyOf(limited);
    expect(limitedBody.error).toBe('judge_rate_limited');
    expect(String(limitedBody.message)).toMatch(/wait a minute/i);

    await createRoom(s, '5.5.5.5');
    const cap = await call(s.app, 'POST', JUDGE_ROOMS_PATH, { src: '5.5.5.6' });
    expect(cap.status).toBe(429);
    const capBody = await bodyOf(cap);
    expect(capBody.error).toBe('judge_room_cap');
    expect(String(capBody.message).length).toBeGreaterThan(10);
  });

  it('expired and locked refusals say so', async () => {
    const s = setup();
    const room = await createRoom(s);
    for (let i = 0; i < JUDGE_JOIN_DEFAULTS.wrongCodesBeforeLockout; i++) {
      await join(s, `ZZZZZ${'ABCDEFGH'[i] ?? 'Z'}`, '6.6.6.6');
      s.clock.set(s.clock.now() + 7_000);
    }
    const locked = await join(s, room.joinCode, '6.6.6.6');
    expect(locked.status).toBe(429);
    const lockedBody = await bodyOf(locked);
    expect(lockedBody.error).toBe('judge_join_locked');
    expect(String(lockedBody.message)).toMatch(/wrong codes/i);

    s.clock.set(s.clock.now() + 31 * 60_000);
    const expired = await join(s, room.joinCode, '7.7.7.7');
    expect(expired.status).toBe(410);
    expect(await bodyOf(expired)).toEqual({
      error: 'judge_room_expired',
      message: 'That room has ended',
    });
  });
});

describe('SRV-35 D: the 401 message reads cleanly', () => {
  it('says an access token is required, with no redaction marker', async () => {
    const s = setup();
    const room = await createRoom(s);
    const res = await call(s.app, 'POST', `/api/auctions/${room.auctionId}/control`, {
      body: { controlId: 'x', action: 'pause' },
    });
    expect(res.status).toBe(401);
    const b = await bodyOf(res);
    expect(b.message).toBe('access token required');
    expect(JSON.stringify(b)).not.toContain('redacted');
  });
});

describe('SRV-35 E: control refusals carry the reason', () => {
  it('names the rule that was hit', async () => {
    const s = setup();
    const room = await createRoom(s);
    const msg = async (body: unknown): Promise<[number, string]> => {
      const res = await control(s, room, body);
      return [res.status, String((await bodyOf(res)).message)];
    };

    expect(await msg({ controlId: 'a1', action: 'hammer' })).toEqual([
      409,
      'The lot is still open: send closeNow 1 to close it now',
    ]);
    expect(await msg({ controlId: 'a2', action: 'resume' })).toEqual([
      409,
      'The lot is not paused',
    ]);
    expect(await msg({ controlId: 'a3', action: 'open' })).toEqual([
      409,
      'The lot is already open',
    ]);
    const [badStatus, badMsg] = await msg({
      controlId: 'a4',
      action: 'extend',
      args: { extraMs: 0 },
    });
    expect(badStatus).toBe(400);
    expect(badMsg).toContain('extraMs');
    const [tooBig] = await msg({ controlId: 'a5', action: 'extend', args: { extraMs: 600_001 } });
    expect(tooBig).toBe(400);

    expect((await control(s, room, { controlId: 'p1', action: 'pause' })).status).toBe(200);
    expect(await msg({ controlId: 'p2', action: 'pause' })).toEqual([
      409,
      'The lot is already paused',
    ]);
    expect(await msg({ controlId: 'p3', action: 'hammer', args: { closeNow: 1 } })).toEqual([
      409,
      'Resume the lot before the hammer',
    ]);
  });

  it('keeps the stale hammer reason and reports an ended lot', async () => {
    const s = setup();
    const room = await createRoom(s);
    const stale = await control(s, room, {
      controlId: 's1',
      action: 'hammer',
      args: { closeNow: 1, expectedPriceCents: 999_999 },
    });
    expect(stale.status).toBe(409);
    expect((await bodyOf(stale)).message).toBe('price_changed');
    expect(
      (await control(s, room, { controlId: 'h', action: 'hammer', args: { closeNow: 1 } })).status,
    ).toBe(200);
    const after = await control(s, room, { controlId: 'p9', action: 'pause' });
    expect(after.status).toBe(409);
    expect((await bodyOf(after)).message).toBe('The lot has already ended');
  });
});

describe('SRV-35 F: join codes are forgiving', () => {
  it('normalizes case, spaces, dashes and the GVL prefix', () => {
    expect(normalizeJoinCode('abc234')).toBe('ABC234');
    expect(normalizeJoinCode(' gvl-abc-234 ')).toBe('ABC234');
    expect(normalizeJoinCode('GVL ABC 234')).toBe('ABC234');
    expect(normalizeJoinCode('ab-c2 34')).toBe('ABC234');
    // A real code that happens to start with GVL is left alone.
    expect(normalizeJoinCode('GVLABC')).toBe('GVLABC');
  });

  it('joins with every spelling of the same code', async () => {
    const s = setup();
    const room = await createRoom(s);
    const c = room.joinCode;
    const spellings = [
      c.toLowerCase(),
      `GVL-${c}`,
      `gvl-${c.slice(0, 3)}-${c.slice(3)}`,
      `${c.slice(0, 3)} ${c.slice(3)}`,
      `  ${c}  `,
    ];
    for (const [i, code] of spellings.entries()) {
      const res = await join(s, code, `9.9.9.${i}`);
      expect(res.status).toBe(200);
    }
  });

  it('a malformed code costs no strike, a well-formed wrong code costs one', async () => {
    const s = setup({ join: { wrongCodesBeforeLockout: 2, attemptsPerIpPerMin: 100 } });
    const room = await createRoom(s);
    for (let i = 0; i < 6; i++) {
      expect((await join(s, `x${i}`, '8.8.8.8')).status).toBe(404);
      s.clock.set(s.clock.now() + 6_000);
    }
    expect((await join(s, room.joinCode, '8.8.8.8')).status).toBe(200);
    expect((await join(s, 'ZZZZZZ', '8.8.8.9')).status).toBe(404);
    s.clock.set(s.clock.now() + 6_000);
    expect((await join(s, 'YYYYYY', '8.8.8.9')).status).toBe(404);
    expect((await join(s, room.joinCode, '8.8.8.9')).status).toBe(429);
  });

  it('one wrong code tried through lookup and join is one strike', async () => {
    const s = setup({ join: { wrongCodesBeforeLockout: 2, attemptsPerIpPerMin: 100 } });
    const room = await createRoom(s);
    const src = '8.7.7.7';
    expect((await call(s.app, 'GET', '/api/auctions/GVL-ZZZZZZ', { src })).status).toBe(404);
    expect((await join(s, 'zzzzzz', src)).status).toBe(404);
    // Two attempts, one strike: the address is not locked yet.
    expect((await join(s, room.joinCode, src)).status).toBe(200);
  });
});

describe('SRV-35 H: the public code lookup is throttled', () => {
  const lookup = (s: Setup, code: string, src: string): Promise<Response> =>
    call(s.app, 'GET', `/api/auctions/${code}`, { src });

  it('looks a code up, in any spelling', async () => {
    const s = setup();
    const room = await createRoom(s);
    const res = await lookup(s, `gvl-${room.joinCode}`, '1.2.3.4');
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toMatchObject({ auctionId: room.auctionId });
  });

  it('locks an address out after wrong codes, for lookups and joins alike', async () => {
    const s = setup();
    const room = await createRoom(s);
    const src = '4.3.2.1';
    const codes = ['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD', 'EEEEEE'];
    for (const code of codes) {
      const res = await lookup(s, code, src);
      expect(res.status).toBe(404);
      expect((await bodyOf(res)).message).toBe('Code not found, check and try again');
      s.clock.set(s.clock.now() + 6_000);
    }
    const locked = await lookup(s, room.joinCode, src);
    expect(locked.status).toBe(429);
    expect(await bodyOf(locked)).toMatchObject({ error: 'code_locked' });
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    // The join door is shut for the same address too.
    expect((await join(s, room.joinCode, src)).status).toBe(429);
    // Another address still works.
    expect((await lookup(s, room.joinCode, '4.3.2.2')).status).toBe(200);
    s.clock.set(s.clock.now() + JUDGE_JOIN_DEFAULTS.lockoutMs + 1);
    expect((await lookup(s, room.joinCode, src)).status).toBe(200);
  });

  it('rate limits lookups per address and recovers after a minute', async () => {
    const s = setup({ join: { attemptsPerIpPerMin: 2, wrongCodesBeforeLockout: 100 } });
    const room = await createRoom(s);
    const src = '5.4.3.2';
    // Lookups get three times the join allowance.
    for (let i = 0; i < 6; i++) expect((await lookup(s, room.joinCode, src)).status).toBe(200);
    const limited = await lookup(s, room.joinCode, src);
    expect(limited.status).toBe(429);
    expect(await bodyOf(limited)).toMatchObject({ error: 'rate_limited' });
    s.clock.set(s.clock.now() + 60_001);
    expect((await lookup(s, room.joinCode, src)).status).toBe(200);
  });

  it('does not throttle a lookup by full auction id', async () => {
    const s = setup({ join: { attemptsPerIpPerMin: 1, wrongCodesBeforeLockout: 1 } });
    const room = await createRoom(s);
    for (let i = 0; i < 5; i++) {
      expect((await lookup(s, room.auctionId, '6.5.4.3')).status).toBe(200);
    }
  });
});
