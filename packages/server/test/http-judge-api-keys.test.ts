import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type AuctionId,
  type BidderId,
  type Cents,
  type Logger,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { JudgeKeyRegistry, parseJudgeKey, parseJudgeKeys, sha256Hex } from '../src/auth/judge-keys';
import { secretSetFromConfig } from '../src/auth/rotation';
import { createHttpApp, mintToken, type HttpApp, type HttpDeps } from '../src/http/app';
import { mountAuctions } from '../src/http/auctions';
import {
  createJudgeRooms,
  JUDGE_JOIN_PATH,
  JUDGE_KEY_HEADER,
  JUDGE_KEY_PATH,
  JUDGE_KEYS_PATH,
  JUDGE_PAUSE_PATH,
  JUDGE_ROOMS_PATH,
  judgeRoomConfig,
  type JudgeRoomsOptions,
} from '../src/http/judge-rooms';
import { DEFAULT_DOCS_ORIGIN } from '../src/http/origins';
import { requestSources } from '../src/http/node-bridge';
import { Room, type RoomDeps } from '../src/room/room';
import { LedgerEngine } from '../src/runtime/ledger-engine';
import { MemoryStore } from '../src/store/memory-store';

const START = 1_789_000_000_000;
const EXPIRES = '2026-11-30T23:59:00Z';
const ADMIN = 'fake-admin-key-fake-admin-key';
const SECRET = 'fake-secret-fake-secret-fake-0000';
// Test-only keys built at run time from fixed bytes; they are not real and not used anywhere.
const mk = (id: string, fill: string) => {
  const secret = fill.repeat(48);
  return { key: `gvl_judge_${id}_${secret}`, secret, id };
};
const A = mk('aaaa1111', 'a');
const B = mk('bbbb2222', 'b');
const WRONG = mk('aaaa1111', 'c');
const entry = (k: { id: string; secret: string }, over: Record<string, unknown> = {}) => ({
  id: k.id,
  hash: sha256Hex(k.secret),
  label: `judge ${k.id}`,
  expiresAt: Date.parse(EXPIRES),
  maxRooms: 2,
  perHour: 10,
  ...over,
});

const OPTS: JudgeRoomsOptions = {
  enabled: true,
  paused: false,
  maxLive: 3,
  ttlMs: 30 * 60_000,
  perIpPerHour: 20,
  globalPerHour: 50,
  maxCeilingCents: 5_000,
  lotWindowMs: 10 * 60_000,
  keyedMax: 6,
};

function setup(entries = [entry(A), entry(B)], over: Partial<JudgeRoomsOptions> = {}) {
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
  const logs: { msg: string; fields: Record<string, unknown> }[] = [];
  const mkLog = (bound: Record<string, unknown>): Logger => ({
    debug: () => undefined,
    info: (msg, f) => void logs.push({ msg, fields: { ...bound, ...f } }),
    warn: (msg, f) => void logs.push({ msg, fields: { ...bound, ...f } }),
    error: (msg, f) => void logs.push({ msg, fields: { ...bound, ...f } }),
    child: (c) => mkLog({ ...bound, ...c }),
  });
  const service: HttpDeps['service'] = {
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
  };
  const deps: HttpDeps = {
    service,
    store,
    clock,
    ids,
    secrets: secretSetFromConfig({ TOKEN_SECRET: SECRET }),
    adminKey: ADMIN,
    publicUrl: 'https://gavel.example.test',
    corsOrigins: [],
    docsOrigins: [DEFAULT_DOCS_ORIGIN],
    log: mkLog({}),
  };
  const rooms = createJudgeRooms({
    ...OPTS,
    keys: new JudgeKeyRegistry(
      parseJudgeKeys(JSON.stringify(entries.map(toJson))).entries,
      undefined,
    ),
    simHolds: {
      acceptsHolds: () => Promise.resolve(true),
      place: async (i) => {
        const room = await service.room(i.auctionId as AuctionId);
        await room.registerBidder({
          bidderId: i.bidderId as BidderId,
          name: i.name,
          ceiling: i.ceilingCents as Cents,
          holdRef: `sim-${i.bidderId}`,
        });
        return `sim-${i.bidderId}`;
      },
    },
    ...over,
  });
  const app = createHttpApp(deps, [mountAuctions, rooms.mount]);
  return { app, deps, clock, store, rooms, logs };
}
const toJson = (e: ReturnType<typeof entry>) => ({
  ...e,
  expiresAt: new Date(e.expiresAt).toISOString(),
});

const call = (
  app: HttpApp,
  method: string,
  path: string,
  o: { body?: unknown; headers?: Record<string, string>; src?: string } = {},
) => {
  const req = new Request(`http://h.test${path}`, {
    method,
    headers: {
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...(o.headers ?? {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify(o.body ?? {}) } : {}),
  });
  requestSources.set(req, o.src ?? '203.0.113.7');
  return app.fetch(req);
};
const withKey = (k: string) => ({ [JUDGE_KEY_HEADER]: k });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const json = async <T = Record<string, unknown>>(r: Response): Promise<T> => (await r.json()) as T;

describe('judge keys: registry', () => {
  it('parses the key shape', () => {
    expect(parseJudgeKey(A.key)).toEqual({ id: A.id, secret: A.secret });
    expect(parseJudgeKey('gvl_judge_short_x')).toBeUndefined();
    expect(parseJudgeKey(`${A.key}x`)).toBeUndefined();
  });

  it('verifies right keys and refuses wrong, expired, revoked ones', () => {
    const { entries } = parseJudgeKeys(JSON.stringify([toJson(entry(A))]));
    const reg = new JudgeKeyRegistry(entries, { key: 'x'.repeat(40), maxRooms: 3, perHour: 20 });
    expect(reg.verify(A.key, START)).toMatchObject({ ok: true });
    expect(reg.verify(WRONG.key, START)).toEqual({ ok: false, reason: 'invalid' });
    expect(reg.verify(B.key, START)).toEqual({ ok: false, reason: 'invalid' });
    expect(reg.verify('', START)).toEqual({ ok: false, reason: 'invalid' });
    expect(reg.verify(A.key, Date.parse(EXPIRES) + 1)).toMatchObject({ reason: 'expired' });
    expect(reg.revoke(A.id)).toBe(true);
    expect(reg.verify(A.key, START)).toMatchObject({ reason: 'revoked' });
    expect(reg.revoke('nope1234')).toBe(false);
    // The legacy shared key is one more entry and never expires.
    expect(reg.verify('x'.repeat(40), START)).toMatchObject({ ok: true, key: { id: 'legacy' } });
  });

  it('stores only a hash: the entry never holds the secret', () => {
    const e = entry(A);
    expect(JSON.stringify(e)).not.toContain(A.secret);
    expect(e.hash).toBe(createHash('sha256').update(A.secret).digest('hex'));
  });

  it('config parsing rejects bad hashes, duplicates, short ids and expiry past the window', () => {
    const bad = (over: Record<string, unknown>) =>
      parseJudgeKeys(JSON.stringify([{ ...toJson(entry(A)), ...over }])).problems;
    expect(bad({ hash: 'abc' })[0]).toMatch(/hash/);
    expect(bad({ id: 'abc' })[0]).toMatch(/id/);
    expect(bad({ expiresAt: '2027-01-01T00:00:00Z' })[0]).toMatch(/expiresAt/);
    expect(bad({ maxRooms: 99 })[0]).toMatch(/maxRooms/);
    expect(bad({})).toEqual([]);
    const dup = parseJudgeKeys(JSON.stringify([toJson(entry(A)), toJson(entry(A))]));
    expect(dup.problems[0]).toMatch(/duplicate/);
    expect(parseJudgeKeys('{').problems).toEqual(['must be a JSON array']);
  });
});

describe('judge keys: over HTTP', () => {
  it('a key creates rooms and the check route names its limits', async () => {
    const { app } = setup();
    const ok = await call(app, 'POST', JUDGE_KEY_PATH, { headers: withKey(A.key) });
    expect(await json(ok)).toEqual({
      ok: true,
      keyId: A.id,
      roomsMax: 2,
      roomsLive: 0,
      expiresAt: EXPIRES,
    });
    const room = await call(app, 'POST', JUDGE_ROOMS_PATH, { headers: withKey(A.key) });
    expect(room.status).toBe(201);
    expect((await json(room)).unlocked).toBe(true);
  });

  it('refuses an expired key with its own code', async () => {
    const { app, clock } = setup();
    clock.set(Date.parse(EXPIRES) + 1);
    const res = await call(app, 'POST', JUDGE_ROOMS_PATH, { headers: withKey(A.key) });
    expect(res.status).toBe(401);
    expect((await json(res)).error).toBe('judge_key_expired');
  });

  it('revoke is admin only, takes effect at once and survives a restart', async () => {
    const s = setup();
    const noAuth = await call(s.app, 'POST', '/api/judge/keys/aaaa1111/revoke');
    expect(noAuth.status).toBe(401);
    const asJudge = await call(s.app, 'POST', '/api/judge/keys/aaaa1111/revoke', {
      headers: { 'x-admin-key': B.key, ...withKey(B.key) },
    });
    expect(asJudge.status).toBe(401);
    const done = await call(s.app, 'POST', '/api/judge/keys/aaaa1111/revoke', {
      headers: { 'x-admin-key': ADMIN },
    });
    expect(await json(done)).toEqual({ id: A.id, revoked: true });
    const after = await call(s.app, 'POST', JUDGE_ROOMS_PATH, { headers: withKey(A.key) });
    expect(after.status).toBe(401);
    expect((await json(after)).error).toBe('judge_key_revoked');
    // The other judge is not touched.
    expect((await call(s.app, 'POST', JUDGE_ROOMS_PATH, { headers: withKey(B.key) })).status).toBe(
      201,
    );
    // A fresh process on the same store reads the revoke from the journal.
    const again = createJudgeRooms({
      ...OPTS,
      keys: new JudgeKeyRegistry(
        parseJudgeKeys(JSON.stringify([toJson(entry(A))])).entries,
        undefined,
      ),
    });
    const app2 = createHttpApp(s.deps, [mountAuctions, again.mount]);
    const res = await call(app2, 'POST', JUDGE_KEY_PATH, { headers: withKey(A.key) });
    expect((await json(res)).error).toBe('judge_key_revoked');
    expect(
      (
        await call(s.app, 'POST', '/api/judge/keys/unknown1/revoke', {
          headers: { 'x-admin-key': ADMIN },
        })
      ).status,
    ).toBe(404);
  });

  it('lists keys for the operator without a hash or a secret', async () => {
    const { app } = setup();
    expect((await call(app, 'GET', JUDGE_KEYS_PATH)).status).toBe(401);
    expect((await call(app, 'GET', JUDGE_KEYS_PATH, { headers: withKey(A.key) })).status).toBe(401);
    const res = await call(app, 'GET', JUDGE_KEYS_PATH, { headers: { 'x-admin-key': ADMIN } });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain(A.id);
    expect(text).not.toContain(A.secret);
    expect(text).not.toContain(sha256Hex(A.secret));
  });

  it('keeps room caps and hourly caps apart between keys', async () => {
    const { app } = setup([entry(A, { maxRooms: 1 }), entry(B, { maxRooms: 1, perHour: 1 })]);
    expect((await call(app, 'POST', JUDGE_ROOMS_PATH, { headers: withKey(A.key) })).status).toBe(
      201,
    );
    const full = await call(app, 'POST', JUDGE_ROOMS_PATH, { headers: withKey(A.key) });
    expect(full.status).toBe(429);
    expect((await json(full)).error).toBe('judge_key_room_cap');
    // B still has its own room.
    expect((await call(app, 'POST', JUDGE_ROOMS_PATH, { headers: withKey(B.key) })).status).toBe(
      201,
    );
    const bFull = await call(app, 'POST', JUDGE_ROOMS_PATH, { headers: withKey(B.key) });
    expect(bFull.status).toBe(429);
    const a = await json(await call(app, 'POST', JUDGE_KEY_PATH, { headers: withKey(A.key) }));
    expect(a.roomsLive).toBe(1);
  });

  it('a key never opens an admin route, whichever header carries it', async () => {
    const { app } = setup();
    const body = {
      title: 'x',
      config: judgeRoomConfig(START, { lotWindowMs: 60_000, maxCeilingCents: 5_000 as Cents }),
    };
    for (const headers of [withKey(A.key), { 'x-admin-key': A.key }, bearer(A.key)]) {
      expect((await call(app, 'POST', '/api/auctions', { headers, body })).status).toBe(401);
      expect(
        (await call(app, 'POST', JUDGE_PAUSE_PATH, { headers, body: { paused: true } })).status,
      ).toBe(401);
    }
  });

  it('never logs the key or its secret, only the key id', async () => {
    const { app, logs } = setup();
    await call(app, 'POST', JUDGE_KEY_PATH, { headers: withKey(A.key) });
    await call(app, 'POST', JUDGE_ROOMS_PATH, { headers: withKey(A.key) });
    await call(app, 'POST', JUDGE_ROOMS_PATH, { headers: withKey(WRONG.key) });
    await call(app, 'POST', '/api/judge/keys/aaaa1111/revoke', {
      headers: { 'x-admin-key': ADMIN },
    });
    await call(app, 'POST', JUDGE_ROOMS_PATH, { headers: withKey(A.key) });
    const text = JSON.stringify(logs);
    for (const k of [A, B, WRONG]) {
      expect(text).not.toContain(k.key);
      expect(text).not.toContain(k.secret);
    }
    expect(text).toContain(A.id);
    expect(logs.map((l) => l.fields.event)).toContain('judge_room.key_revoked');
  });

  it('the legacy shared key keeps working next to per-judge keys', async () => {
    const legacy = 'legacy-judge-key-'.padEnd(40, 'z');
    const { app } = setup([entry(A)], {
      keys: new JudgeKeyRegistry([], { key: legacy, maxRooms: 3, perHour: 20 }),
    });
    expect((await call(app, 'POST', JUDGE_ROOMS_PATH, { headers: withKey(legacy) })).status).toBe(
      201,
    );
    expect((await call(app, 'POST', JUDGE_ROOMS_PATH, { headers: withKey(A.key) })).status).toBe(
      401,
    );
  });
});

describe('judge bids over HTTP', () => {
  const play = async (s: ReturnType<typeof setup>) => {
    const room = await json<{
      auctionId: string;
      joinCode: string;
      auctioneerToken: string;
      reviewerToken: string;
    }>(await call(s.app, 'POST', JUDGE_ROOMS_PATH, { headers: withKey(A.key) }));
    const joined = await json<{ sessionToken: string }>(
      await call(s.app, 'POST', JUDGE_JOIN_PATH, {
        body: { code: room.joinCode, displayName: 'Asha' },
      }),
    );
    const hold = await call(s.app, 'POST', `/api/judge/rooms/${room.auctionId}/sim-hold`, {
      headers: bearer(joined.sessionToken),
      body: { ceilingCents: 5000, name: 'Asha' },
    });
    expect(hold.status).toBe(200);
    return {
      ...room,
      session: joined.sessionToken,
      path: `/api/judge/rooms/${room.auctionId}/bids`,
    };
  };

  it('accepts a bid with only a session token, no Origin and no key', async () => {
    const s = setup();
    const r = await play(s);
    const res = await call(s.app, 'POST', r.path, {
      headers: bearer(r.session),
      body: { amount: 1500 },
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ accepted: true, amount: 1500 });
  });

  it('answers a refused bid as 409 with the reason, and a retry with the same mid as the first answer', async () => {
    const s = setup();
    const r = await play(s);
    const low = await call(s.app, 'POST', r.path, {
      headers: bearer(r.session),
      body: { amount: 500 },
    });
    expect(low.status).toBe(409);
    expect(await json(low)).toMatchObject({ accepted: false, reason: 'below_reserve' });
    const mid = '01JC5ZR1B2C3D4E5F6G7H8J9K0';
    const first = await json(
      await call(s.app, 'POST', r.path, {
        headers: bearer(r.session),
        body: { amount: 1500, mid },
      }),
    );
    const again = await json(
      await call(s.app, 'POST', r.path, {
        headers: bearer(r.session),
        body: { amount: 1500, mid },
      }),
    );
    expect(again).toEqual(first);
  });

  it('refuses reviewer, auctioneer and missing tokens, and bad bodies', async () => {
    const s = setup();
    const r = await play(s);
    expect((await call(s.app, 'POST', r.path, { body: { amount: 1500 } })).status).toBe(401);
    expect(
      (
        await call(s.app, 'POST', r.path, {
          headers: bearer(r.reviewerToken),
          body: { amount: 1500 },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call(s.app, 'POST', r.path, {
          headers: bearer(r.auctioneerToken),
          body: { amount: 1500 },
        })
      ).status,
    ).toBe(401);
    expect(
      (await call(s.app, 'POST', r.path, { headers: withKey(A.key), body: { amount: 1500 } }))
        .status,
    ).toBe(401);
    expect(
      (await call(s.app, 'POST', r.path, { headers: bearer(r.session), body: { amount: 1.5 } }))
        .status,
    ).toBe(400);
    expect(
      (
        await call(s.app, 'POST', r.path, {
          headers: bearer(r.session),
          body: { amount: 1500, extra: 1 },
        })
      ).status,
    ).toBe(400);
  });

  it('answers 404 for an auction that is not a judge room', async () => {
    const s = setup();
    const id = s.deps.ids.mint<'AuctionId'>();
    await s.deps.service.createAuction(
      id,
      judgeRoomConfig(START, { lotWindowMs: 600_000, maxCeilingCents: 5_000 as Cents }),
      s.deps.ids.mint<'Jti'>(),
    );
    const bidderId = s.deps.ids.mint<'BidderId'>();
    const session = await mintToken(s.deps, 'session', id, bidderId, bidderId);
    const res = await call(s.app, 'POST', `/api/judge/rooms/${id}/bids`, {
      headers: bearer(session.token),
      body: { amount: 1500 },
    });
    expect(res.status).toBe(404);
  });

  it('answers 410 once the room has expired', async () => {
    const s = setup();
    const r = await play(s);
    s.clock.set(s.clock.now() + OPTS.ttlMs + 1);
    const res = await call(s.app, 'POST', r.path, {
      headers: bearer(r.session),
      body: { amount: 1500 },
    });
    expect([401, 410]).toContain(res.status);
  });
});

describe('docs site CORS', () => {
  const docs = { origin: DEFAULT_DOCS_ORIGIN };

  it('lets the docs origin call judge routes and read the answer', async () => {
    const { app } = setup();
    const pre = await call(app, 'OPTIONS', JUDGE_ROOMS_PATH, {
      headers: { ...docs, 'access-control-request-method': 'POST' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(DEFAULT_DOCS_ORIGIN);
    expect(pre.headers.get('access-control-allow-headers')).toContain('x-judge-key');
    const res = await call(app, 'POST', JUDGE_ROOMS_PATH, {
      headers: { ...docs, ...withKey(A.key) },
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('access-control-allow-origin')).toBe(DEFAULT_DOCS_ORIGIN);
    expect(res.headers.get('access-control-expose-headers')).toContain('retry-after');
  });

  it('does not open admin routes, the key list or other origins to the docs site', async () => {
    const { app } = setup();
    const pause = await call(app, 'POST', JUDGE_PAUSE_PATH, {
      headers: { ...docs, 'x-admin-key': ADMIN },
      body: { paused: true },
    });
    expect(pause.status).toBe(403);
    expect(pause.headers.get('access-control-allow-origin')).toBeNull();
    const list = await call(app, 'GET', JUDGE_KEYS_PATH, {
      headers: { ...docs, 'x-admin-key': ADMIN },
    });
    expect(list.headers.get('access-control-allow-origin')).toBeNull();
    const revoke = await call(app, 'POST', '/api/judge/keys/aaaa1111/revoke', {
      headers: { ...docs, 'x-admin-key': ADMIN },
    });
    expect(revoke.status).toBe(403);
    const create = await call(app, 'POST', '/api/auctions', {
      headers: { ...docs, 'x-admin-key': ADMIN },
    });
    expect(create.status).toBe(403);
    const other = await call(app, 'POST', JUDGE_ROOMS_PATH, {
      headers: { origin: 'https://evil.example', ...withKey(A.key) },
    });
    expect(other.status).toBe(403);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('scripts/make-judge-key.mjs', () => {
  it('prints a key whose hash matches and that the host accepts', () => {
    const script = join(__dirname, '..', '..', '..', 'scripts', 'make-judge-key.mjs');
    const out = JSON.parse(
      execFileSync('node', [script, '--json', '--label', 'Asha'], { encoding: 'utf8' }),
    ) as {
      key: string;
      entry: { id: string; hash: string; expiresAt: string; label: string };
    };
    const parsed = parseJudgeKey(out.key);
    expect(parsed).toBeDefined();
    expect(parsed?.id).toBe(out.entry.id);
    expect(sha256Hex(parsed?.secret ?? '')).toBe(out.entry.hash);
    expect(out.entry.expiresAt).toBe(EXPIRES);
    expect(JSON.stringify(out.entry)).not.toContain(parsed?.secret);
    const { entries, problems } = parseJudgeKeys(JSON.stringify([out.entry]));
    expect(problems).toEqual([]);
    expect(new JudgeKeyRegistry(entries, undefined).verify(out.key, START)).toMatchObject({
      ok: true,
    });
  });

  it('refuses an expiry past the judging window', () => {
    const script = join(__dirname, '..', '..', '..', 'scripts', 'make-judge-key.mjs');
    expect(() =>
      execFileSync('node', [script, '--expires', '2027-02-01T00:00:00Z'], { stdio: 'pipe' }),
    ).toThrow();
  });
});
