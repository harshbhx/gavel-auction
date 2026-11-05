import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type BidderId,
  type CancelTimer,
  type Cents,
  type ConnId,
  type EpochMs,
  type MsgId,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { CONFIRM_TTL_MS } from '../src/room/confirm';
import { MemoryTransport } from '../src/room/memory-transport';
import { Room, type Connection, type RoomDeps } from '../src/room/room';
import { LedgerEngine } from '../src/runtime/ledger-engine';
import { MemoryStore } from '../src/store/memory-store';

const START = 1_789_000_000_000;

const config = {
  mode: 'english',
  currency: 'USD',
  reserve: 10000,
  minIncrement: 500,
  endTs: START + 600_000,
  softCloseWindowMs: 5000,
  softCloseExtensionMs: 10_000,
  maxExtensions: 2,
  ceilingPresets: [50000],
  confirmConfidenceThreshold: 0.85,
} as unknown as AuctionConfig;

/** A manual clock that remembers every timer it was given, so a test can fire one late. */
class SpyClock extends ManualClock {
  readonly set_: Array<() => void> = [];
  override setTimer(atMs: number, fn: () => void): CancelTimer {
    this.set_.push(fn);
    return super.setTimer(atMs, fn);
  }
}

const build = async () => {
  const clock = new SpyClock(START);
  const ids = new SeqIds();
  const store = new MemoryStore(() => clock.now());
  const auctionId = ids.mint<'AuctionId'>();
  const deps: RoomDeps = {
    store,
    clock,
    ids,
    engine: (cfg, createdAt) => new LedgerEngine(auctionId, cfg, createdAt),
  };
  const room = await Room.create(auctionId, config, 'auctioneer-sub', deps);
  const b1 = ids.mint<'BidderId'>() as BidderId;
  const b2 = ids.mint<'BidderId'>() as BidderId;
  await room.registerBidder({ bidderId: b1, name: 'Ada', ceiling: 50000 as Cents, holdRef: 'h1' });
  await room.registerBidder({ bidderId: b2, name: 'Bo', ceiling: 50000 as Cents, holdRef: 'h2' });
  const connectTo = async (
    target: Room,
    role: Connection['role'],
    bidderId?: BidderId,
    last?: number,
  ) => {
    const transport = new MemoryTransport();
    const conn: Connection = {
      id: ids.mint<'ConnId'>() as ConnId,
      role,
      sub: bidderId ?? `${role}-sub`,
      transport,
      ...(bidderId ? { bidderId } : {}),
    };
    await target.attach(conn, last);
    return { conn, transport };
  };
  const connect = (role: Connection['role'], bidderId?: BidderId, last?: number) =>
    connectTo(room, role, bidderId, last);
  const bid = (amount: number, source: 'qr' | 'voice' = 'qr') => ({
    v: 1 as const,
    t: 'bid' as const,
    mid: ids.mint<'MsgId'>() as MsgId,
    amount,
    source,
    ...(source === 'voice' ? { confidence: 0.5, transcript: 'five hundred' } : {}),
  });
  const types = async () => (await store.readEvents(auctionId, 1, 200)).map((e) => e.type);
  return { clock, ids, store, deps, auctionId, room, b1, b2, connect, connectTo, bid, types };
};

describe('pause and hammer (HRD-15, #1486, #1487)', () => {
  it('refuses a hammer on a paused lot as a conflict and does not rebuild', async () => {
    const t = await build();
    const boss = await t.connect('auctioneer');
    await t.room.control(boss.conn, { controlId: 'p1', action: 'pause' });
    const engineBefore = t.room.activeEngine;
    await t.room.control(boss.conn, { controlId: 'h1', action: 'hammer', args: { closeNow: 1 } });
    expect(boss.transport.messages('error').at(-1)).toMatchObject({ code: 'conflict' });
    expect(boss.transport.messages('error').filter((e) => e.code === 'internal')).toHaveLength(0);
    // A rebuilt room would have a new engine object.
    await t.connect('screen');
    expect(t.room.activeEngine).toBe(engineBefore);
    expect(await t.types()).not.toContain('hammered');
    await t.room.control(boss.conn, { controlId: 'r1', action: 'resume' });
    await t.room.control(boss.conn, { controlId: 'h2', action: 'hammer', args: { closeNow: 1 } });
    expect(await t.types()).toContain('hammered');
  });

  it('shows the paused flag and answers a bid with auction_paused', async () => {
    const t = await build();
    const a = await t.connect('bidder', t.b1);
    const boss = await t.connect('auctioneer');
    const screen = await t.connect('screen');
    await t.room.submitBid(a.conn, t.bid(10000));
    t.clock.set(START + 20_000);
    await t.room.control(boss.conn, { controlId: 'p1', action: 'pause' });
    const price = screen.transport.messages('price').at(-1);
    expect(price).toMatchObject({ paused: true, remainingMs: 580_000, endTs: START + 600_000 });
    t.clock.set(START + 590_000);
    const b = await t.connect('bidder', t.b2);
    await t.room.submitBid(b.conn, t.bid(10500));
    expect(b.transport.messages('bid_rejected')).toMatchObject([{ reason: 'auction_paused' }]);
    const state = b.transport.messages('state').at(-1) as { snapshot: Record<string, unknown> };
    expect(state.snapshot).toMatchObject({ paused: true, remainingMs: 580_000 });
    await t.room.control(boss.conn, { controlId: 'r1', action: 'resume' });
    const after = screen.transport.messages('price').at(-1);
    expect(after?.paused).toBeUndefined();
    expect(after?.endTs).toBe(START + 590_000 + 580_000);
  });

  it('sends a snapshot with the flag when the lot is paused before any bid', async () => {
    const t = await build();
    const boss = await t.connect('auctioneer');
    await t.room.control(boss.conn, { controlId: 'p1', action: 'pause' });
    const state = boss.transport.messages('state').at(-1) as { snapshot: Record<string, unknown> };
    expect(state.snapshot.paused).toBe(true);
  });
});

describe('open control (HRD-15, #1489)', () => {
  it('answers conflict and appends nothing', async () => {
    const t = await build();
    const boss = await t.connect('auctioneer');
    const before = await t.store.lastSeq(t.auctionId);
    await t.room.control(boss.conn, { controlId: 'o1', action: 'open' });
    expect(boss.transport.messages('error').at(-1)).toMatchObject({ code: 'conflict' });
    expect(await t.store.lastSeq(t.auctionId)).toBe(before);
    expect(await t.types()).not.toContain('control');
  });
});

describe('confirmed voice bid audit (HRD-15, #1432)', () => {
  it('shows a reconnecting bidder one accepted row per placed bid', async () => {
    const t = await build();
    const a = await t.connect('bidder', t.b1);
    const screen = await t.connect('screen');
    const seqBefore = t.room.lastSeq;
    await t.room.submitBid(a.conn, t.bid(12000, 'voice'));
    const confirmId = String(a.transport.messages('confirm_request')[0]?.confirmId);
    await t.room.respondConfirm(a.conn, { v: 1, t: 'confirm_response', confirmId, accept: true });
    const late = await t.connect('screen', undefined, seqBefore);
    const rows = late.transport.messages('audit_event');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ audit: { outcome: 'accepted' } });
    // The live viewer saw the same single row.
    expect(screen.transport.messages('audit_event')).toHaveLength(1);
    const boss = await t.connect('auctioneer');
    expect(boss.transport.messages('audit_event')).toHaveLength(0);
  });
});

describe('held confirmation across a restart (HRD-15, #1436)', () => {
  it('re-arms an open confirmation and expires it once', async () => {
    const t = await build();
    const a = await t.connect('bidder', t.b1);
    await t.room.submitBid(a.conn, t.bid(12000, 'voice'));
    const confirmId = String(a.transport.messages('confirm_request')[0]?.confirmId);
    await t.room.close();
    t.clock.advance(1000);
    const reborn = await Room.load(t.auctionId, t.deps);
    const again = await t.connectTo(reborn, 'bidder', t.b1);
    // The bidder can still answer after the restart.
    const answer = { v: 1 as const, t: 'confirm_response' as const, confirmId, accept: false };
    await reborn.respondConfirm(again.conn, answer);
    expect(again.transport.messages('error')).toHaveLength(0);
    expect(again.transport.messages('bid_rejected')).toMatchObject([{ reason: 'unconfirmed' }]);
    expect((await t.types()).filter((x) => x === 'confirm_resolved')).toHaveLength(1);
  });

  it('resolves a confirmation that expired while the room was down', async () => {
    const t = await build();
    const a = await t.connect('bidder', t.b1);
    await t.room.submitBid(a.conn, t.bid(12000, 'voice'));
    await t.room.close();
    t.clock.advance(CONFIRM_TTL_MS + 1000);
    const reborn = await Room.load(t.auctionId, t.deps);
    const events = await t.store.readEvents(t.auctionId, 1, 200);
    const resolved = events.filter((e) => e.type === 'confirm_resolved');
    expect(resolved).toMatchObject([{ outcome: 'expired' }]);
    await reborn.close();
    // A second restart adds nothing.
    const again = await Room.load(t.auctionId, t.deps);
    await again.close();
    expect((await t.types()).filter((x) => x === 'confirm_resolved')).toHaveLength(1);
  });
});

describe('end-of-lot retry after close (HRD-15)', () => {
  it('does not re-arm the retry timer once the room is closed', async () => {
    const t = await build();
    await t.connect('screen');
    const fns = [...t.clock.set_];
    await t.room.close();
    const armed = t.clock.set_.length;
    for (const fn of fns) fn();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(t.clock.set_.length).toBe(armed);
    t.clock.set((START + 700_000) as EpochMs);
    expect(t.clock.set_.length).toBe(armed);
  });
});

describe('mailbox depth gauge (HRD-15, #1434)', () => {
  it('counts queued commands and returns to zero', async () => {
    const t = await build();
    const boss = await t.connect('auctioneer');
    expect(t.room.mailboxDepth).toBe(0);
    const p1 = t.room.control(boss.conn, { controlId: 'p1', action: 'pause' });
    const p2 = t.room.control(boss.conn, { controlId: 'r1', action: 'resume' });
    expect(t.room.mailboxDepth).toBe(2);
    await Promise.all([p1, p2]);
    expect(t.room.mailboxDepth).toBe(0);
  });
});
