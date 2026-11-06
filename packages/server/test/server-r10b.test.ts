import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GavelError,
  type AuctionConfig,
  type AuctionId,
  type EpochMs,
  type BidMsg,
  type BidderId,
  type Cents,
  type ConnId,
  type RoomEvent,
} from '@gavel/shared';
import { SystemClock } from '@gavel/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { composeServer, type Composed } from '../src/boot/compose';
import type { HttpDeps } from '../src/http/app';
import { withConnection } from '../src/http/auctions';
import { DEFAULT_CAPS } from '../src/limits/caps';
import { MetricsCollector } from '../src/ops/metrics';
import { confirmAudit } from '../src/room/confirm';
import { CONFIRM_REASON, resolvedEvent } from '../src/room/confirm-resolve';
import { FencedStore } from '../src/room/fence';
import { MemoryTransport } from '../src/room/memory-transport';
import { Room, type Connection } from '../src/room/room';
import { LedgerEngine } from '../src/runtime/ledger-engine';
import { MemoryStore } from '../src/store/memory-store';
import { setup } from './room-harness';

class ConflictStore extends MemoryStore {
  conflictNext = false;
  failBids = false;
  override async appendEvents(
    auctionId: AuctionId,
    expectedSeq: number,
    events: RoomEvent[],
  ): Promise<void> {
    if (this.conflictNext) throw new GavelError('conflict', 'stale expectedSeq');
    if (this.failBids && events.some((e) => e.type === 'bid_accepted')) {
      throw new Error('disk full');
    }
    await super.appendEvents(auctionId, expectedSeq, events);
  }
}

const LOT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as AuctionId;
/** The real engine, which can pause and resume (the harness engine cannot). */
const engine = (cfg: AuctionConfig, createdAt: EpochMs) => new LedgerEngine(LOT_ID, cfg, createdAt);

const gauges = { connections: () => 0, rooms: () => 0, mailboxDepth: () => 0 };

describe('#1517 fence path behind the real FencedStore', () => {
  it('closes every connection with 4010 when a bid append conflicts', async () => {
    const inner = new ConflictStore();
    const ref: { room?: Room } = {};
    const store = new FencedStore(inner, {
      // The service does the same: fence the room one microtask after the conflict.
      onFenced: () => void Promise.resolve().then(() => ref.room?.fence()),
    });
    const t = await setup({ store: store as unknown as MemoryStore });
    ref.room = t.room;
    const bidder = await t.connect('bidder', t.b1);
    const screen = await t.connect('screen');
    inner.conflictNext = true;
    await t.room.submitBid(bidder.conn, t.bid(10000));
    expect(t.room.isStopped).toBe(true);
    expect(bidder.transport.messages('error').map((m) => m.code)).toContain('host_fenced');
    expect(bidder.transport.closed?.code).toBe(4010);
    expect(screen.transport.closed?.code).toBe(4010);
  });

  it('fences on a conflict during pause, resume and extend too', async () => {
    const inner = new ConflictStore();
    const t = await setup({ store: inner, engine });
    const boss = await t.connect('auctioneer');
    const screen = await t.connect('screen');
    await t.room.submitBid((await t.connect('bidder', t.b1)).conn, t.bid(10000));
    inner.conflictNext = true;
    await t.room.control(boss.conn, { controlId: 'p1', action: 'pause' });
    expect(t.room.isStopped).toBe(true);
    expect(screen.transport.closed?.code).toBe(4010);
    expect(boss.transport.closed?.code).toBe(4010);
  });
});

describe('#1516 caps reach the room', () => {
  it('the room refuses at a lowered cap and counts the refusal', async () => {
    const t = await setup({ caps: { ...DEFAULT_CAPS, connectionsPerRoom: 1 } });
    await t.connect('screen');
    const refused = await t.connect('screen');
    expect(refused.transport.messages('error').map((m) => m.code)).toEqual(['room_full']);
  });
});

describe('#1520 paused bids are not cached', () => {
  it('lets the same mid through after resume and logs nothing while paused', async () => {
    const t = await setup({ engine });
    const boss = await t.connect('auctioneer');
    const a = await t.connect('bidder', t.b1);
    await t.room.submitBid((await t.connect('bidder', t.b2)).conn, t.bid(10000));
    await t.room.control(boss.conn, { controlId: 'p1', action: 'pause' });
    const seq = t.room.lastSeq;
    const msg: BidMsg = t.bid(15000, t.ids.mint<'MsgId'>());
    await t.room.submitBid(a.conn, msg);
    expect(a.transport.messages('bid_rejected')).toMatchObject([
      { reason: 'auction_paused', retryable: true },
    ]);
    expect(t.room.lastSeq).toBe(seq);
    await t.room.control(boss.conn, { controlId: 'r1', action: 'resume' });
    await t.room.submitBid(a.conn, msg);
    expect(a.transport.messages('bid_accepted')).toMatchObject([{ mid: msg.mid }]);
  });
});

describe('#1521 internal HTTP connections', () => {
  const httpDeps = (t: { ids: unknown }): HttpDeps => ({ ids: t.ids }) as unknown as HttpDeps;

  it('skips the room cap and never supersedes a real socket', async () => {
    const t = await setup({
      caps: { ...DEFAULT_CAPS, connectionsPerRoom: 1, connectionsPerBidder: 1 },
    });
    const real = await t.connect('auctioneer');
    let ran = false;
    const frames = await withConnection(httpDeps(t), t.room, 'auctioneer', 'auctioneer-sub', () => {
      ran = true;
      return Promise.resolve();
    });
    expect(ran).toBe(true);
    expect(frames.map((f) => f.t)).toContain('state');
    expect(real.transport.closed).toBeUndefined();
    expect(t.room.connectionCount).toBe(1);
  });

  it('throws without running fn when the room refuses the attach', async () => {
    const t = await setup();
    t.room.fence();
    let ran = false;
    await expect(
      withConnection(httpDeps(t), t.room, 'screen', 'public', () => {
        ran = true;
        return Promise.resolve();
      }),
    ).rejects.toMatchObject({ code: 'host_fenced' });
    expect(ran).toBe(false);
  });
});

describe('#1522 latency histograms are fed', () => {
  it('records one bid and its appends', async () => {
    const metrics = new MetricsCollector(gauges);
    const t = await setup({ metrics });
    const a = await t.connect('bidder', t.b1);
    await t.room.submitBid(a.conn, t.bid(10000));
    const snap = metrics.snapshot();
    expect(snap.bidLatencyMs.count).toBe(1);
    expect(snap.storeAppendMs.count).toBeGreaterThan(0);
  });

  it('lists the loaded room for the ops view', async () => {
    const t = await setup();
    await t.connect('screen');
    expect(t.room.opsView()).toMatchObject({
      auctionId: t.auctionId,
      connections: 1,
      mailboxDepth: 0,
    });
  });
});

describe('#1519 accept with no bid in the log is asked again after a restart', () => {
  it('revives the hold and places the bid on the next accept', async () => {
    const store = new ConflictStore();
    const t = await setup({ store });
    const c1 = await t.connect('bidder', t.b1);
    const mid = t.ids.mint<'MsgId'>();
    await t.room.submitBid(c1.conn, {
      v: 1,
      t: 'bid',
      mid,
      amount: 12000,
      source: 'voice',
      confidence: 0.62,
    });
    const confirmId = String(c1.transport.messages('confirm_request')[0]?.confirmId);
    store.failBids = true;
    await t.room.respondConfirm(c1.conn, { v: 1, t: 'confirm_response', confirmId, accept: true });
    store.failBids = false;
    // The accept is one append now, so the failed write leaves the hold untouched (HRD-23).
    expect(
      (await store.readEvents(t.auctionId, 1, 100)).some((e) => e.type === 'confirm_resolved'),
    ).toBe(false);
    // A log written before that change can still hold an accept with no bid: build one.
    const seq = t.room.lastSeq + 1;
    const ts = t.clock.now();
    await store.appendEvents(t.auctionId, t.room.lastSeq, [
      resolvedEvent(
        { auctionId: t.auctionId, seq, ts },
        confirmId,
        'accepted',
        confirmAudit(
          {
            confirmId,
            bidderId: t.b1,
            mid,
            amount: 12000 as Cents,
            expiresAt: (ts + 1) as EpochMs,
          },
          t.ids.mint<'BidId'>(),
          'accepted',
          CONFIRM_REASON.accepted,
          ts,
          seq,
        ),
      ),
    ]);
    const logged = await store.readEvents(t.auctionId, 1, 100);
    expect(logged.some((e) => e.type === 'confirm_resolved')).toBe(true);
    expect(logged.some((e) => e.type === 'bid_accepted')).toBe(false);

    // Restart: a fresh room replays the same log.
    const reloaded = await Room.load(t.auctionId, t.deps);
    const transport = new MemoryTransport();
    const conn: Connection = {
      id: t.ids.mint<'ConnId'>() as ConnId,
      role: 'bidder',
      sub: t.b1,
      bidderId: t.b1 as BidderId,
      transport,
    };
    await reloaded.attach(conn);
    await reloaded.respondConfirm(conn, { v: 1, t: 'confirm_response', confirmId, accept: true });
    expect(transport.messages('bid_accepted')).toMatchObject([{ mid, amount: 12000 }]);
    reloaded.stop();
    t.room.stop();
  });
});

describe('#1516 and #1522 compose wiring', () => {
  const running: Composed[] = [];
  afterEach(async () => {
    for (const app of running.splice(0)) await app.close();
  });
  const lot = () =>
    ({
      mode: 'english',
      currency: 'USD',
      reserve: 10000,
      minIncrement: 500,
      endTs: new SystemClock().now() + 3_600_000,
      softCloseWindowMs: 30_000,
      softCloseExtensionMs: 30_000,
      maxExtensions: 5,
      ceilingPresets: [30000, 50000],
      confirmConfidenceThreshold: 0.85,
    }) as never;

  it('enforces MAX_ROOMS from the env and serves /ops/rooms', async () => {
    const app = await composeServer(
      {
        PUBLIC_URL: 'http://localhost:8080',
        TOKEN_SECRET: 'test-secret-test-secret-test-secret-0123',
        ADMIN_KEY: 'test-admin-key-test-admin-key',
        PAYMENTS: 'fake',
        LOG_LEVEL: 'error',
        MAX_ROOMS: '1',
      },
      { sink: () => undefined },
    );
    running.push(app);
    await app.service.createAuction('01HZZZZZZZZZZZZZZZZZZZZZZA' as never, lot(), 'a1');
    await expect(
      app.service.createAuction('01HZZZZZZZZZZZZZZZZZZZZZZB' as never, lot(), 'a2'),
    ).rejects.toMatchObject({ code: 'room_cap' });
    const port = await app.listen(0);
    const url = `http://127.0.0.1:${port}/ops/rooms`;
    expect((await fetch(url)).status).toBe(401);
    const res = await fetch(url, { headers: { 'x-admin-key': 'test-admin-key-test-admin-key' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rooms: Array<{ auctionId: string }> };
    expect(body.rooms.map((r) => r.auctionId)).toEqual(['01HZZZZZZZZZZZZZZZZZZZZZZA']);
  });

  it('creates MAX_ROOMS + 1 auctions in sequence, finishing each, then restarts (HRD-42)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gavel-rooms-seq-'));
    const env = {
      PUBLIC_URL: 'http://localhost:8080',
      TOKEN_SECRET: 'test-secret-test-secret-test-secret-0123',
      ADMIN_KEY: 'test-admin-key-test-admin-key',
      PAYMENTS: 'fake',
      LOG_LEVEL: 'error',
      STORE: 'file',
      DATA_DIR: dir,
      MAX_ROOMS: '2',
    };
    const first = await composeServer(env, { sink: () => undefined });
    const ids = ['A', 'B', 'C'].map((c) => `01HZZZZZZZZZZZZZZZZZZZZZZ${c}`);
    for (const id of ids) {
      await first.service.createAuction(id as never, lot(), 'a1');
      await (await first.service.room(id as never)).abort('test');
      await first.service.idle();
    }
    expect(first.service.stats().rooms).toBeLessThanOrEqual(2);
    await first.close();
    const second = await composeServer(env, { sink: () => undefined });
    running.push(second);
    await second.service.idle();
    await second.service.resume();
    expect(second.service.stats().rooms).toBe(0);
    await second.service.createAuction('01HZZZZZZZZZZZZZZZZZZZZZZD' as never, lot(), 'a1');
    expect(second.service.stats().rooms).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not keep finished auctions loaded after a restart (R12-S02)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gavel-rooms-'));
    const env = {
      PUBLIC_URL: 'http://localhost:8080',
      TOKEN_SECRET: 'test-secret-test-secret-test-secret-0123',
      ADMIN_KEY: 'test-admin-key-test-admin-key',
      PAYMENTS: 'fake',
      LOG_LEVEL: 'error',
      STORE: 'file',
      DATA_DIR: dir,
    };
    const first = await composeServer({ ...env, MAX_ROOMS: '5' }, { sink: () => undefined });
    const ids = ['A', 'B', 'C'].map((c) => `01HZZZZZZZZZZZZZZZZZZZZZZ${c}`);
    for (const id of ids) await first.service.createAuction(id as never, lot(), 'a1');
    for (const id of ids.slice(0, 2)) await (await first.service.room(id as never)).abort('test');
    await first.service.idle();
    await first.close();
    const second = await composeServer({ ...env, MAX_ROOMS: '2' }, { sink: () => undefined });
    running.push(second);
    await second.service.idle();
    await second.service.resume();
    expect(second.service.stats().rooms).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});
