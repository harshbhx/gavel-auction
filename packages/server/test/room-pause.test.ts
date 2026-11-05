import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type BidderId,
  type Cents,
  type ConnId,
  type EngineBidResult,
  type EngineState,
  type EngineView,
  type EpochMs,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { MemoryTransport } from '../src/room/memory-transport';
import type { PauseEnginePort } from '../src/room/pause';
import { Room, type Connection } from '../src/room/room';
import { MemoryStore } from '../src/store/memory-store';
import { START, TestEngine, config } from './room-harness';

/** Test engine with its own deadline that pause and resume move, like the real lot clock. */
class PausableEngine extends TestEngine implements PauseEnginePort {
  private end: EpochMs;
  private left: number | undefined;

  constructor(cfg: AuctionConfig) {
    super(cfg);
    this.end = cfg.endTs;
  }

  override placeBid(bidder: BidderId, amount: Cents, ts: EpochMs): EngineBidResult {
    if (this.left !== undefined) return { ok: false, code: 'auction_paused' };
    if (ts >= this.end) return { ok: false, code: 'closed' };
    return super.placeBid(bidder, amount, 0 as EpochMs);
  }

  override tick(now: EpochMs): EngineState {
    return super.tick(now >= this.end ? (Number.MAX_SAFE_INTEGER as EpochMs) : (0 as EpochMs));
  }

  override view(): EngineView {
    return { ...super.view(), endTs: this.end };
  }

  pause(now: EpochMs): void {
    this.left = this.end - now;
  }

  resume(now: EpochMs): void {
    if (this.left === undefined) throw new Error('not_paused');
    this.end = (now + this.left) as EpochMs;
    this.left = undefined;
  }

  isPaused(): boolean {
    return this.left !== undefined;
  }
}

const build = async () => {
  const clock = new ManualClock(START);
  const ids = new SeqIds();
  const store = new MemoryStore(() => clock.now());
  const cfg = { ...config, endTs: START + 10_000 } as AuctionConfig;
  const auctionId = ids.mint<'AuctionId'>();
  const room = await Room.create(auctionId, cfg, 'auctioneer-sub', {
    store,
    clock,
    ids,
    engine: (c) => new PausableEngine(c),
  });
  const b1 = ids.mint<'BidderId'>() as BidderId;
  await room.registerBidder({ bidderId: b1, name: 'Ada', ceiling: 50000 as Cents, holdRef: 'h1' });
  const connect = async (role: Connection['role'], bidderId?: BidderId) => {
    const transport = new MemoryTransport();
    const conn: Connection = {
      id: ids.mint<'ConnId'>() as ConnId,
      role,
      sub: bidderId ?? `${role}-sub`,
      transport,
      ...(bidderId ? { bidderId } : {}),
    };
    await room.attach(conn);
    return { conn, transport };
  };
  const bid = (amount: number) => ({
    v: 1 as const,
    t: 'bid' as const,
    mid: ids.mint<'MsgId'>(),
    amount,
    source: 'qr' as const,
  });
  return { clock, ids, store, auctionId, room, b1, connect, bid };
};

describe('pause and resume (R-RT-049, T-RT-040)', () => {
  it('rejects bids while paused, stops the timer and shifts endTs on resume', async () => {
    const t = await build();
    const a = await t.connect('bidder', t.b1);
    const boss = await t.connect('auctioneer');
    const endTs = () => t.room.activeEngine?.view().endTs;
    const state = () => t.room.activeEngine?.view().state;

    t.clock.set((START + 5000) as EpochMs);
    await t.room.control(boss.conn, { controlId: 'p1', action: 'pause' });
    await t.room.submitBid(a.conn, t.bid(10000));
    expect(a.transport.messages('bid_rejected')).toMatchObject([{ reason: 'auction_paused' }]);

    // The old deadline passes while paused: the room stays open.
    t.clock.set((START + 8000) as EpochMs);
    await t.connect('screen');
    expect(state()).toBe('OPEN');

    t.clock.set((START + 9000) as EpochMs);
    await t.room.control(boss.conn, { controlId: 'r1', action: 'resume' });
    expect(endTs()).toBe(START + 14_000);

    // Repeating the same controlId changes nothing.
    t.clock.set((START + 9500) as EpochMs);
    await t.room.control(boss.conn, { controlId: 'r1', action: 'resume' });
    expect(endTs()).toBe(START + 14_000);

    await t.room.submitBid(a.conn, t.bid(10000));
    expect(t.room.activeEngine?.view().price).toBe(10000);

    // The timer follows the new deadline.
    t.clock.set((START + 13_999) as EpochMs);
    await t.connect('screen');
    expect(state()).toBe('OPEN');
    t.clock.set((START + 14_000) as EpochMs);
    await t.connect('screen');
    expect(state()).toBe('CLOSING');
  });

  it('refuses to resume a lot that is not paused', async () => {
    const t = await build();
    const boss = await t.connect('auctioneer');
    await t.room.control(boss.conn, { controlId: 'r1', action: 'resume' });
    expect(boss.transport.messages('error')).toMatchObject([{ code: 'conflict' }]);
  });
});
