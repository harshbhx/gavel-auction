// Unit tests of the traffic simulation (FIX-68): the guard rules and a whole run against fakes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Budget,
  ErrorWindow,
  RateGate,
  Recorder,
  isAllowedPath,
  parseConfig,
  percentile,
  planWaves,
  renderMarkdown,
  ulid,
} from '../../qa/traffic-sim/lib.mjs';
import { runSimulation } from '../../qa/traffic-sim/sim.mjs';

const ok = { CONFIRM: 'yes' };

test('confirm must be yes', () => {
  assert.throws(() => parseConfig({}), /confirm/);
  assert.throws(() => parseConfig({ CONFIRM: 'Yes' }), /confirm/);
  assert.equal(parseConfig(ok).rooms, 3);
});

test('defaults and bounds', () => {
  const c = parseConfig(ok);
  assert.equal(c.bidders, 6);
  assert.equal(c.durationMinutes, 5);
  assert.equal(c.web, 'https://gavel.dualmindlab.tech');
  assert.equal(c.api, 'https://api.gavel.dualmindlab.tech');
  assert.throws(() => parseConfig({ ...ok, DURATION_MINUTES: '11' }), /duration_minutes/);
  assert.throws(() => parseConfig({ ...ok, ROOMS: '9' }), /rooms/);
  assert.throws(() => parseConfig({ ...ok, ROOMS: '0' }), /rooms/);
  assert.throws(() => parseConfig({ ...ok, BIDDERS_PER_ROOM: '13' }), /bidders_per_room/);
});

test('targets must be allow-listed https origins', () => {
  assert.throws(
    () => parseConfig({ ...ok, API_URL: 'http://api.gavel.dualmindlab.tech' }),
    /https/,
  );
  assert.throws(() => parseConfig({ ...ok, API_URL: 'https://example.com' }), /allow list/);
  assert.throws(() => parseConfig({ ...ok, API_URL: 'https://evil.com/?x=dualmindlab.tech' }), /./);
  assert.throws(() => parseConfig({ ...ok, TARGET: 'https://gavel.dualmindlab.tech/x' }), /origin/);
  assert.throws(() => parseConfig({ ...ok, TARGET: 'https://u:p@gavel.dualmindlab.tech' }), /./);
});

test('webhook and admin paths are never allowed', () => {
  for (const p of [
    '/webhooks/paypal',
    '/api/admin/rooms',
    '/api/judge/pause',
    '/api/judge/key',
    '/api/holds',
    '/api/auctions/ABC/kill',
    '/admin',
  ]) {
    assert.equal(isAllowedPath(p), false, p);
  }
  for (const p of [
    '/api/judge/rooms',
    '/api/judge/join',
    '/api/judge/rooms/01ABC/sim-hold',
    '/api/auctions/01ABC/snapshot',
    '/api/auctions/01ABC/control',
  ]) {
    assert.equal(isAllowedPath(p), true, p);
  }
});

test('planWaves never exceeds the wave size', () => {
  assert.deepEqual(planWaves(3), [3]);
  assert.deepEqual(planWaves(8), [3, 3, 2]);
  assert.deepEqual(planWaves(1), [1]);
});

test('percentile uses nearest rank', () => {
  assert.equal(percentile([], 50), 0);
  assert.equal(percentile([5], 95), 5);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  assert.equal(percentile([1, 2, 3, 4], 100), 4);
  assert.equal(
    percentile(
      Array.from({ length: 100 }, (_, i) => i + 1),
      95,
    ),
    95,
  );
});

test('budget stops at its maximum', () => {
  const b = new Budget(2);
  assert.deepEqual([b.take(), b.take(), b.take()], [true, true, false]);
  assert.equal(b.used, 2);
});

test('error window trips above 20 percent and forgets old samples', () => {
  const w = new ErrorWindow(30_000, 0.2, 20);
  for (let i = 0; i < 19; i += 1) w.add(false, 1000); // below the sample floor
  assert.equal(w.tripped(1000), false);
  w.add(false, 1000);
  assert.equal(w.tripped(1000), true);
  assert.equal(w.tripped(40_000), false); // everything aged out
  const calm = new ErrorWindow(30_000, 0.2, 20);
  for (let i = 0; i < 80; i += 1) calm.add(true, i);
  for (let i = 0; i < 20; i += 1) calm.add(false, 100 + i); // exactly 20 percent is not above
  assert.equal(calm.tripped(200), false);
  calm.add(false, 300);
  assert.equal(calm.tripped(300), true);
});

test('rate gate spaces starts', async () => {
  let t = 0;
  const waits = [];
  const gate = new RateGate(
    10,
    () => t,
    async (ms) => {
      waits.push(ms);
      t += ms;
    },
  );
  await gate.wait();
  await gate.wait();
  await gate.wait();
  assert.deepEqual(waits, [6000, 6000]);
});

test('ulid has the shape the API checks', () => {
  const id = ulid(Date.now(), () => 0.5);
  assert.match(id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
});

test('recorder summarises per step and counts statuses', () => {
  const r = new Recorder();
  r.record('join', 100, 200, true);
  r.record('join', 300, 429, false);
  const s = r.summary();
  assert.equal(s.total, 2);
  assert.equal(s.successRate, 0.5);
  assert.equal(s.perStep.join.max, 300);
  assert.deepEqual(s.statuses, { 200: 1, 429: 1 });
});

// ------------------------------------------------------------------------- engine against fakes

function makeWorld(over = {}) {
  let t = 1_700_000_000_000;
  const world = {
    calls: [],
    rooms: 0,
    clock: {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
        await new Promise((r) => setImmediate(r));
      },
    },
    sockets: [],
    agents: new Set(),
  };
  const res = (status, json, headers = {}) => ({
    status,
    json: async () => json,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  });
  world.fetchImpl = async (url, init) => {
    const u = new URL(url);
    world.calls.push(`${init.method} ${u.pathname}`);
    world.agents.add(init.headers['user-agent']);
    const p = u.pathname;
    if (p === '/api/judge/capabilities') {
      return res(200, over.caps ?? { judgeRooms: true, accepting: true, simHolds: true });
    }
    if (p === '/api/judge/rooms') {
      if (over.rateLimitAt !== undefined && world.rooms >= over.rateLimitAt) {
        return res(429, { error: 'judge_rate_limited' }, { 'retry-after': '120' });
      }
      world.rooms += 1;
      return res(201, {
        auctionId: `ROOM${world.rooms}`,
        joinCode: `CODE${world.rooms}`,
        auctioneerToken: 'a-token',
      });
    }
    if (p === '/api/judge/join') {
      if (over.failJoins) return res(500, { error: 'boom' });
      return res(200, { sessionToken: 's-token', bidderId: `B${world.calls.length}` });
    }
    if (p.endsWith('/sim-hold')) return res(200, { holdId: 'h', simulated: true });
    if (p.endsWith('/control')) return res(200, { ok: true });
    if (p.endsWith('/snapshot')) {
      return res(200, {
        snapshot: {
          config: { ceilingPresets: [2000, 5000], reserve: 1000, minIncrement: 500 },
          settlement: { auctionState: over.settle ?? 'SETTLED' },
        },
      });
    }
    return res(404, {});
  };
  world.openSocket = (wsUrl, origin) => {
    const handlers = {};
    const sock = {
      wsUrl,
      origin,
      on: (e, fn) => (handlers[e] = fn),
      send: (text) => {
        const m = JSON.parse(text);
        if (m.t === 'join') {
          setImmediate(() =>
            handlers.message(
              JSON.stringify({ v: 1, t: 'state', snapshot: { minNext: 1000, leaderId: null } }),
            ),
          );
        }
        if (m.t === 'bid') {
          setImmediate(() =>
            handlers.message(JSON.stringify({ v: 1, t: 'bid_accepted', mid: m.mid, amount: 1000 })),
          );
        }
      },
      close: () => {},
    };
    world.sockets.push(sock);
    setImmediate(() => handlers.open?.());
    return sock;
  };
  return world;
}

const baseCfg = (extra = {}) => ({
  web: 'https://gavel.dualmindlab.tech',
  api: 'https://api.gavel.dualmindlab.tech',
  rooms: 2,
  bidders: 2,
  durationMinutes: 1,
  budget: 5000,
  ...extra,
});

const ioOf = (w) => ({
  fetchImpl: w.fetchImpl,
  openSocket: w.openSocket,
  now: w.clock.now,
  sleep: w.clock.sleep,
  rand: () => 0.5,
});

test('a clean run settles every room and calls only allowed paths', async () => {
  const w = makeWorld();
  const report = await runSimulation(baseCfg(), ioOf(w));
  assert.equal(report.verdict, 'completed');
  assert.equal(report.rooms.created, 2);
  assert.equal(report.rooms.completed, 2);
  assert.equal(report.rooms.settled, 2);
  assert.equal(report.rooms.failed, 0);
  assert.deepEqual([...w.agents], ['gavel-traffic-sim']);
  for (const c of w.calls) assert.equal(isAllowedPath(c.split(' ')[1]), true, c);
  assert.ok(report.summary.perStep.bid.n > 0);
  assert.ok(report.summary.perStep.join.n === 4);
  assert.ok(w.sockets.every((s) => s.origin === 'https://gavel.dualmindlab.tech'));
  assert.ok(report.budget.used <= report.budget.max);
  const md = renderMarkdown(report);
  assert.match(md, /Verdict: \*\*completed\*\*/);
  assert.match(md, /\| bid \|/);
});

test('the first 429 on room creation stops the run and is reported', async () => {
  const w = makeWorld({ rateLimitAt: 1 });
  const report = await runSimulation(baseCfg({ rooms: 5 }), ioOf(w));
  assert.equal(report.verdict, 'rate_limited');
  assert.equal(report.firstRateLimit.code, 'judge_rate_limited');
  assert.equal(report.firstRateLimit.retryAfter, '120');
  assert.equal(report.firstRateLimit.roomsCreatedBefore, 1);
  assert.equal(w.calls.filter((c) => c === 'POST /api/judge/rooms').length, 2);
  assert.match(renderMarkdown(report), /First 429 on room creation/);
});

test('a high error rate aborts the run', async () => {
  const w = makeWorld({ failJoins: true });
  const report = await runSimulation(baseCfg({ rooms: 3, bidders: 12 }), ioOf(w));
  assert.equal(report.verdict, 'aborted');
  assert.match(report.reason, /error rate/);
});

test('the request budget is a hard stop', async () => {
  const w = makeWorld();
  const report = await runSimulation(baseCfg({ budget: 8 }), ioOf(w));
  assert.equal(report.verdict, 'aborted');
  assert.match(report.reason, /budget/);
  assert.ok(report.budget.used <= 8);
});

test('an unavailable host is reported and nothing is created', async () => {
  const w = makeWorld({ caps: { judgeRooms: false } });
  const report = await runSimulation(baseCfg(), ioOf(w));
  assert.equal(report.verdict, 'not_available');
  assert.equal(w.rooms, 0);
});

test('a room that does not reach SETTLED is counted as not final', async () => {
  const w = makeWorld({ settle: 'CAPTURING' });
  const report = await runSimulation(baseCfg({ rooms: 1 }), ioOf(w));
  assert.equal(report.rooms.settled, 0);
  assert.equal(report.rooms.pending, 1);
});

test('a failed settlement is counted as failed', async () => {
  const w = makeWorld({ settle: 'FAILED_NEEDS_REVIEW' });
  const report = await runSimulation(baseCfg({ rooms: 1 }), ioOf(w));
  assert.equal(report.rooms.failed, 1);
});
