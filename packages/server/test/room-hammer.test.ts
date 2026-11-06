import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type AuctionId,
  type BidderId,
  type Cents,
  type ConnId,
  type EngineBidResult,
  type EngineState,
  type EngineView,
  type EpochMs,
  type RoomEvent,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { MemoryTransport } from '../src/room/memory-transport';
import { Room, type Connection, type RoomDeps } from '../src/room/room';
import type { HammerEnginePort, HammerResult, SettlePort } from '../src/room/settle-port';
import { MemoryStore } from '../src/store/memory-store';

const START = 1_789_000_000_000;

const baseConfig = {
  mode: 'english',
  currency: 'USD',
  reserve: 10000,
  minIncrement: 500,
  endTs: START + 600_000,
  softCloseWindowMs: 30_000,
  softCloseExtensionMs: 30_000,
  maxExtensions: 5,
  ceilingPresets: [50000],
  confirmConfidenceThreshold: 0.85,
} as unknown as AuctionConfig;

/** English-auction engine with a hammer, standing in for the engine runtime adapter. */
class HammerEngine implements HammerEnginePort {
  private readonly ceilings = new Map<BidderId, Cents>();
  private readonly top = new Map<BidderId, Cents>();
  private price: Cents | null = null;
  private leader: BidderId | null = null;
  private state: EngineState = 'OPEN';

  constructor(private readonly cfg: AuctionConfig) {}

  register(bidder: BidderId, ceiling: Cents): void {
    this.ceilings.set(bidder, ceiling);
  }

  placeBid(bidder: BidderId, amount: Cents, ts: EpochMs): EngineBidResult {
    if (this.state !== 'OPEN' || ts >= this.cfg.endTs) return { ok: false, code: 'closed' };
    if (!this.ceilings.has(bidder)) return { ok: false, code: 'unregistered' };
    if (this.leader === bidder) return { ok: false, code: 'already_leading' };
    if (amount < this.minNext()) return { ok: false, code: 'below_increment' };
    this.price = amount;
    this.leader = bidder;
    this.top.set(bidder, amount);
    return { ok: true };
  }

  tick(now: EpochMs): EngineState {
    if (this.state === 'OPEN' && now >= this.cfg.endTs) this.state = 'CLOSING';
    return this.state;
  }

  hammer(): HammerResult {
    if (this.state !== 'OPEN' && this.state !== 'CLOSING') throw new Error('cannot_hammer');
    this.state = 'SETTLING';
    const ranking = [...this.top]
      .map(([bidderId, amount]) => ({ bidderId, amount }))
      .sort((a, b) => b.amount - a.amount);
    return { winnerId: this.leader, price: (this.price ?? 0) as Cents, ranking };
  }

  view(): EngineView {
    return {
      state: this.state,
      price: this.price,
      leader: this.leader,
      endTs: this.cfg.endTs,
      extensions: 0,
      minNext: this.minNext(),
    };
  }

  private minNext(): Cents {
    return (this.price === null ? this.cfg.reserve : this.price + this.cfg.minIncrement) as Cents;
  }
}

class StubPayments implements SettlePort {
  calls: Array<{ auctionId: AuctionId; outcome: HammerResult }> = [];
  async settle(auctionId: AuctionId, outcome: HammerResult): Promise<void> {
    this.calls.push({ auctionId, outcome });
  }
}

const setup = async (opts: { autoHammerDelayMs?: number; payments?: boolean } = {}) => {
  const clock = new ManualClock(START);
  const ids = new SeqIds();
  const store = new MemoryStore(() => clock.now());
  const payments = new StubPayments();
  const deps: RoomDeps = {
    store,
    clock,
    ids,
    engine: (cfg) => new HammerEngine(cfg),
    ...(opts.payments === false ? {} : { settle: payments }),
  };
  const config = {
    ...baseConfig,
    ...(opts.autoHammerDelayMs !== undefined ? { autoHammerDelayMs: opts.autoHammerDelayMs } : {}),
  } as AuctionConfig;
  const auctionId = ids.mint<'AuctionId'>();
  const room = await Room.create(auctionId, config, 'auctioneer-sub', deps);
  const b1 = ids.mint<'BidderId'>();
  const b2 = ids.mint<'BidderId'>();
  await room.registerBidder({ bidderId: b1, name: 'Ada', ceiling: 50000 as Cents, holdRef: 'h1' });
  await room.registerBidder({ bidderId: b2, name: 'Bo', ceiling: 30000 as Cents, holdRef: 'h2' });
  const connect = async (target: Room, role: Connection['role'], bidderId?: BidderId) => {
    const transport = new MemoryTransport();
    const conn: Connection = {
      id: ids.mint<'ConnId'>() as ConnId,
      role,
      sub: bidderId ?? `${role}-sub`,
      transport,
      ...(bidderId ? { bidderId } : {}),
    };
    await target.attach(conn);
    return { conn, transport };
  };
  const bid = (amount: number) => ({
    v: 1 as const,
    t: 'bid' as const,
    mid: ids.mint<'MsgId'>(),
    amount,
    source: 'qr' as const,
  });
  const flush = async (target: Room = room) => {
    await connect(target, 'screen');
  };
  const events = async (): Promise<RoomEvent[]> => store.readEvents(auctionId, 1, 1000);
  return {
    clock,
    ids,
    store,
    deps,
    payments,
    auctionId,
    room,
    b1,
    b2,
    connect,
    bid,
    events,
    flush,
  };
};

const types = (evs: RoomEvent[]) => evs.map((e) => e.type);

describe('hammer and auto-hammer (R-RT-044, R-RT-050, R-RT-051)', () => {
  it('auto-hammers autoHammerDelayMs after CLOSING and broadcasts one hammer frame', async () => {
    const t = await setup({ autoHammerDelayMs: 3000 });
    const c1 = await t.connect(t.room, 'bidder', t.b1);
    const screen = await t.connect(t.room, 'screen');
    await t.room.submitBid(c1.conn, t.bid(10000));
    t.clock.set(START + 600_000);
    await t.flush();
    expect(screen.transport.messages('hammer')).toHaveLength(0);
    t.clock.set(START + 603_000);
    await t.flush();
    for (const tr of [c1.transport, screen.transport]) {
      const frames = tr.messages('hammer');
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({ winnerId: t.b1, price: 10000 });
    }
    expect(types(await t.events())).toEqual([
      'auction_created',
      'bidder_registered',
      'bidder_registered',
      'bid_accepted',
      'state_changed',
      'hammered',
      'settle_requested',
    ]);
    expect(t.payments.calls).toHaveLength(1);
  });

  it('flags a lot the auctioneer ended as stopped, on the frame, the snapshot and after reload', async () => {
    const t = await setup();
    const c1 = await t.connect(t.room, 'bidder', t.b1);
    const boss = await t.connect(t.room, 'auctioneer');
    await t.room.submitBid(c1.conn, t.bid(10000));
    await t.room.control(boss.conn, {
      controlId: 'stop1',
      action: 'hammer',
      args: { closeNow: 1 },
    });
    expect(c1.transport.messages('hammer')[0]).toMatchObject({ stopped: true });
    const late = await t.connect(t.room, 'screen');
    expect(late.transport.messages('state').at(-1)).toMatchObject({ snapshot: { stopped: true } });
    const restarted = await Room.load(t.auctionId, t.deps);
    const after = await t.connect(restarted, 'screen');
    expect(after.transport.messages('state').at(-1)).toMatchObject({
      snapshot: { stopped: true },
    });
  });

  it('signals registration closed on the hammer frame, the snapshot and after reload', async () => {
    const t = await setup();
    const c1 = await t.connect(t.room, 'bidder', t.b1);
    const boss = await t.connect(t.room, 'auctioneer');
    const early = await t.connect(t.room, 'screen');
    expect(early.transport.messages('state').at(-1)?.snapshot).not.toHaveProperty(
      'registrationClosed',
    );
    await t.room.submitBid(c1.conn, t.bid(10000));
    await t.room.control(boss.conn, { controlId: 'rc1', action: 'hammer', args: { closeNow: 1 } });
    expect(c1.transport.messages('hammer')[0]).toMatchObject({ registrationClosed: true });
    const restarted = await Room.load(t.auctionId, t.deps);
    const after = await t.connect(restarted, 'screen');
    expect(after.transport.messages('state').at(-1)).toMatchObject({
      snapshot: { registrationClosed: true },
    });
  });

  it('refuses a hammer whose expected price or leader moved, and applies nothing', async () => {
    const t = await setup();
    const c1 = await t.connect(t.room, 'bidder', t.b1);
    const boss = await t.connect(t.room, 'auctioneer');
    await t.room.submitBid(c1.conn, t.bid(10000));
    await t.room.control(boss.conn, {
      controlId: 'st1',
      action: 'hammer',
      args: { closeNow: 1, expectedPriceCents: 5000, expectedLeaderPaddle: 1 },
    });
    await t.room.control(boss.conn, {
      controlId: 'st2',
      action: 'hammer',
      args: { closeNow: 1, expectedPriceCents: 10000, expectedLeaderPaddle: 2 },
    });
    expect(boss.transport.messages('error').map((m) => m.message)).toEqual([
      'price_changed',
      'leader_changed',
    ]);
    expect(types(await t.events())).not.toContain('hammered');
    await t.room.control(boss.conn, {
      controlId: 'st3',
      action: 'hammer',
      args: { closeNow: 1, expectedPriceCents: 10000, expectedLeaderPaddle: 1 },
    });
    expect(types(await t.events())).toContain('hammered');
  });

  it('leaves stopped off when the timer ended the lot', async () => {
    const t = await setup({ autoHammerDelayMs: 3000 });
    const c1 = await t.connect(t.room, 'bidder', t.b1);
    await t.room.submitBid(c1.conn, t.bid(10000));
    t.clock.set(START + 600_000);
    await t.flush();
    t.clock.set(START + 603_000);
    await t.flush();
    expect(c1.transport.messages('hammer')).toHaveLength(1);
    expect(c1.transport.messages('hammer')[0]).not.toHaveProperty('stopped');
    const late = await t.connect(t.room, 'screen');
    expect(late.transport.messages('state').at(-1)?.snapshot).not.toHaveProperty('stopped');
  });

  it('does not auto-hammer when no delay is configured', async () => {
    const t = await setup();
    t.clock.set(START + 700_000);
    await t.flush();
    expect(types(await t.events())).not.toContain('hammered');
  });

  it('skips the auto-hammer when the auctioneer hammered first', async () => {
    const t = await setup({ autoHammerDelayMs: 3000 });
    const c1 = await t.connect(t.room, 'bidder', t.b1);
    const boss = await t.connect(t.room, 'auctioneer');
    await t.room.submitBid(c1.conn, t.bid(10000));
    t.clock.set(START + 600_000);
    await t.flush();
    t.clock.set(START + 601_000);
    await t.room.control(boss.conn, { controlId: 'c1', action: 'hammer' });
    t.clock.set(START + 610_000);
    await t.flush();
    expect(types(await t.events()).filter((x) => x === 'hammered')).toHaveLength(1);
    expect(c1.transport.messages('hammer')).toHaveLength(1);
    expect(t.payments.calls).toHaveLength(1);
  });

  it('is idempotent by controlId and across repeated hammers', async () => {
    const t = await setup();
    const c1 = await t.connect(t.room, 'bidder', t.b1);
    const boss = await t.connect(t.room, 'auctioneer');
    await t.room.submitBid(c1.conn, t.bid(10000));
    t.clock.set(START + 600_000);
    await t.flush();
    await t.room.control(boss.conn, { controlId: 'c1', action: 'hammer' });
    const before = await t.store.lastSeq(t.auctionId);
    await t.room.control(boss.conn, { controlId: 'c1', action: 'hammer' });
    await t.room.control(boss.conn, { controlId: 'c2', action: 'hammer' });
    expect(await t.store.lastSeq(t.auctionId)).toBe(before);
    expect(boss.transport.messages('hammer')).toHaveLength(3);
    expect(c1.transport.messages('hammer')).toHaveLength(1);
    expect(t.payments.calls).toHaveLength(1);
  });

  it('refuses control from bidders and screens, and early hammer without closeNow', async () => {
    const t = await setup();
    const c1 = await t.connect(t.room, 'bidder', t.b1);
    const screen = await t.connect(t.room, 'screen');
    const boss = await t.connect(t.room, 'auctioneer');
    await t.room.control(c1.conn, { controlId: 'x', action: 'hammer' });
    await t.room.control(screen.conn, { controlId: 'y', action: 'hammer' });
    expect(c1.transport.messages('error')).toMatchObject([{ code: 'forbidden' }]);
    expect(screen.transport.messages('error')).toMatchObject([{ code: 'forbidden' }]);
    await t.room.control(boss.conn, { controlId: 'z', action: 'hammer' });
    expect(boss.transport.messages('error')).toMatchObject([{ code: 'conflict' }]);
    await t.room.control(boss.conn, { controlId: 'z2', action: 'pause' });
    expect(boss.transport.messages('error')[1]).toMatchObject({ code: 'bad_message' });
    expect(types(await t.events())).not.toContain('hammered');
  });

  it('hammers in OPEN with closeNow, then rejects further bids as closed', async () => {
    const t = await setup();
    const c1 = await t.connect(t.room, 'bidder', t.b1);
    const c2 = await t.connect(t.room, 'bidder', t.b2);
    const boss = await t.connect(t.room, 'auctioneer');
    await t.room.submitBid(c1.conn, t.bid(10000));
    await t.room.submitBid(c2.conn, t.bid(10500));
    await t.room.control(boss.conn, { controlId: 'c1', action: 'hammer', args: { closeNow: 1 } });
    const frame = c1.transport.messages('hammer')[0];
    expect(frame).toMatchObject({ winnerId: t.b2, price: 10500 });
    expect(frame?.ranking).toEqual([
      { bidderId: t.b2, amount: 10500 },
      { bidderId: t.b1, amount: 10000 },
    ]);
    await t.room.submitBid(c1.conn, t.bid(20000));
    expect(c1.transport.messages('bid_rejected')).toMatchObject([{ reason: 'closed' }]);
  });

  it('keeps the seq gapless for every viewer across control, hammer and settle request', async () => {
    const t = await setup();
    const c1 = await t.connect(t.room, 'bidder', t.b1);
    const screen = await t.connect(t.room, 'screen');
    const boss = await t.connect(t.room, 'auctioneer');
    await t.room.submitBid(c1.conn, t.bid(10000));
    await t.room.control(boss.conn, { controlId: 'c1', action: 'hammer', args: { closeNow: 1 } });
    const seqs = screen.transport.messages().map((m) => m.seq as number);
    for (let i = 1; i < seqs.length; i++) {
      const step = (seqs[i] ?? 0) - (seqs[i - 1] ?? 0);
      expect(step === 0 || step === 1).toBe(true);
    }
    expect(new Set(seqs)).toContain(await t.store.lastSeq(t.auctionId));
  });

  it('declares an unsold lot with a null winner', async () => {
    const t = await setup({ autoHammerDelayMs: 0 });
    const screen = await t.connect(t.room, 'screen');
    t.clock.set(START + 600_000);
    await t.flush();
    // The zero-delay timer is registered while the close is handled; one more tick fires it.
    t.clock.set(START + 600_000);
    await t.flush();
    expect(screen.transport.messages('hammer')[0]).toMatchObject({ winnerId: null, price: 0 });
  });
});

describe('settlement (R-RT-051..053, R-RT-060)', () => {
  const hammered = async () => {
    const t = await setup();
    const c1 = await t.connect(t.room, 'bidder', t.b1);
    const c2 = await t.connect(t.room, 'bidder', t.b2);
    const screen = await t.connect(t.room, 'screen');
    const boss = await t.connect(t.room, 'auctioneer');
    await t.room.submitBid(c1.conn, t.bid(10000));
    await t.room.control(boss.conn, { controlId: 'c1', action: 'hammer', args: { closeNow: 1 } });
    return { t, c1, c2, screen, boss };
  };
  const statusOf = (tr: MemoryTransport) =>
    (tr.messages('state').at(-1)?.snapshot as { status: string }).status;

  it('hands the outcome to payments once, with the winner and price', async () => {
    const { t } = await hammered();
    expect(t.payments.calls).toHaveLength(1);
    expect(t.payments.calls[0]?.outcome).toMatchObject({ winnerId: t.b1, price: 10000 });
  });

  it('orders updates by rev, drops stale ones, and shows each bidder only their own state', async () => {
    const { t, c1, c2, screen } = await hammered();
    const per = { [t.b1]: 'CAPTURING', [t.b2]: 'VOIDING' } as const;
    await t.room.reportSettlement({ rev: 1, auctionState: 'WINNER_SELECTED', perBidder: per });
    await t.room.reportSettlement({ rev: 3, auctionState: 'CAPTURED', perBidder: per });
    const before = await t.store.lastSeq(t.auctionId);
    await t.room.reportSettlement({ rev: 2, auctionState: 'CAPTURING', perBidder: per });
    await t.room.reportSettlement({ rev: 3, auctionState: 'CAPTURED', perBidder: per });
    expect(await t.store.lastSeq(t.auctionId)).toBe(before);
    expect(c1.transport.messages('settlement_update').map((m) => m.rev)).toEqual([1, 3]);
    expect(c1.transport.messages('settlement_update')[0]).toMatchObject({ you: 'CAPTURING' });
    expect(c2.transport.messages('settlement_update')[0]).toMatchObject({ you: 'VOIDING' });
    expect(screen.transport.messages('settlement_update')[0]?.you).toBeUndefined();
  });

  it('sends every viewer a ladder of counts with no names, holds or amounts (issue 712)', async () => {
    const { t, c1, screen } = await hammered();
    const per = { [t.b1]: 'CAPTURED', [t.b2]: 'VOIDING' } as const;
    await t.room.reportSettlement({ rev: 1, auctionState: 'CAPTURED', perBidder: per });
    for (const tr of [c1.transport, screen.transport]) {
      const frame = tr.messages('settlement_update')[0];
      expect(frame?.ladder).toEqual({ counts: { CAPTURED: 1, VOIDING: 1 } });
      expect(JSON.stringify(frame?.ladder)).not.toContain(t.b1);
    }
    await t.room.reportSettlement({ rev: 2, auctionState: 'SETTLED', perBidder: {} });
    expect(screen.transport.messages('settlement_update')[1]?.ladder).toBeUndefined();
  });

  it('reaches DONE only on SETTLED or FAILED_NEEDS_REVIEW', async () => {
    const { t, screen } = await hammered();
    await t.room.reportSettlement({ rev: 1, auctionState: 'CAPTURED', perBidder: {} });
    const late = await t.connect(t.room, 'screen');
    expect(statusOf(late.transport)).toBe('SETTLING');
    await t.room.reportSettlement({ rev: 2, auctionState: 'SETTLED', perBidder: {} });
    const later = await t.connect(t.room, 'screen');
    expect(statusOf(later.transport)).toBe('DONE');
    expect(
      (later.transport.messages('state')[0]?.snapshot as { settlement: unknown }).settlement,
    ).toMatchObject({ rev: 2, auctionState: 'SETTLED' });
    expect(screen.transport.messages('settlement_update')).toHaveLength(2);
  });

  it('rejects malformed or premature updates without touching the log', async () => {
    const t = await setup();
    await expect(
      t.room.reportSettlement({ rev: 1, auctionState: 'SETTLED', perBidder: {} }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const { t: h } = await hammered();
    const before = await h.store.lastSeq(h.auctionId);
    await expect(
      h.room.reportSettlement({
        rev: 1,
        auctionState: 'CAPTURED',
        perBidder: {},
        amountCaptured: 1.5 as Cents,
      }),
    ).rejects.toMatchObject({ code: 'bad_message' });
    expect(await h.store.lastSeq(h.auctionId)).toBe(before);
  });

  it('rebuilds a hammered, settled room from the log with the same view', async () => {
    const { t } = await hammered();
    await t.room.reportSettlement({ rev: 1, auctionState: 'SETTLED', perBidder: {} });
    const calls = t.payments.calls.length;
    const restarted = await Room.load(t.auctionId, t.deps);
    const v = await t.connect(restarted, 'screen');
    expect(statusOf(v.transport)).toBe('DONE');
    expect(t.payments.calls).toHaveLength(calls);
    // A settled room does not re-settle and still answers a repeat hammer.
    const boss = await t.connect(restarted, 'auctioneer');
    await restarted.control(boss.conn, { controlId: 'again', action: 'hammer' });
    expect(boss.transport.messages('hammer')).toHaveLength(1);
  });

  it('resumes settlement after a restart between hammered and the settle call', async () => {
    const t = await setup({ payments: false });
    const c1 = await t.connect(t.room, 'bidder', t.b1);
    const boss = await t.connect(t.room, 'auctioneer');
    await t.room.submitBid(c1.conn, t.bid(10000));
    await t.room.control(boss.conn, { controlId: 'c1', action: 'hammer', args: { closeNow: 1 } });
    expect(types(await t.events())).not.toContain('settle_requested');
    const payments = new StubPayments();
    await Room.load(t.auctionId, { ...t.deps, settle: payments });
    expect(payments.calls).toHaveLength(1);
    expect(payments.calls[0]?.outcome).toMatchObject({ winnerId: t.b1, price: 10000 });
    // A second restart re-calls settle (not yet settled) but never appends a second request.
    await Room.load(t.auctionId, { ...t.deps, settle: payments });
    expect(payments.calls).toHaveLength(2);
    expect(types(await t.events()).filter((x) => x === 'settle_requested')).toHaveLength(1);
  });

  it('re-arms the auto-hammer after a restart in CLOSING', async () => {
    const t = await setup({ autoHammerDelayMs: 3000 });
    t.clock.set(START + 600_000);
    await t.flush();
    await t.room.close();
    const restarted = await Room.load(t.auctionId, t.deps);
    const screen = await t.connect(restarted, 'screen');
    t.clock.set(START + 603_000);
    await t.flush(restarted);
    expect(screen.transport.messages('hammer')).toHaveLength(1);
  });
});

describe('round 3 hardening (RT3)', () => {
  it('tries the auto-hammer again after a store error at the due time (SERVICE-R3-13)', async () => {
    const t = await setup({ autoHammerDelayMs: 3000 });
    const c1 = await t.connect(t.room, 'bidder', t.b1);
    await t.room.submitBid(c1.conn, t.bid(10000));
    t.clock.set(START + 600_000);
    await t.flush();
    const append = t.store.appendEvents.bind(t.store);
    let down = true;
    t.store.appendEvents = async (...args: Parameters<typeof append>) => {
      if (down) throw new Error('store down');
      return append(...args);
    };
    t.clock.set(START + 603_000);
    await t.flush();
    expect(types(await t.events())).not.toContain('hammered');
    down = false;
    t.clock.set(START + 610_000);
    await t.flush();
    expect(types(await t.events())).toContain('hammered');
  });

  it('refuses a registration after the hammer (SERVICE-R3-09)', async () => {
    const t = await setup({ autoHammerDelayMs: 3000 });
    t.clock.set(START + 600_000);
    await t.flush();
    t.clock.set(START + 603_000);
    await t.flush();
    expect(types(await t.events())).toContain('hammered');
    await expect(
      t.room.registerBidder({
        bidderId: t.ids.mint<'BidderId'>(),
        name: 'Late',
        ceiling: 40000 as Cents,
        holdRef: 'h9',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('round 12 server hardening (R12-S01)', () => {
  it('refuses a client control id in the kill-switch namespace (R12-S01)', async () => {
    const t = await setup();
    const c1 = await t.connect(t.room, 'bidder', t.b1);
    const boss = await t.connect(t.room, 'auctioneer');
    await t.room.submitBid(c1.conn, t.bid(10000));
    await t.room.control(boss.conn, {
      controlId: `abort:${t.auctionId}`,
      action: 'hammer',
      args: { closeNow: 1 },
    });
    expect(boss.transport.messages('error')).toMatchObject([{ code: 'bad_message' }]);
    expect(types(await t.events())).not.toContain('hammered');
    // The room is still open: a normal id still hammers the sale with the real winner.
    await t.room.control(boss.conn, { controlId: 'c1', action: 'hammer', args: { closeNow: 1 } });
    const restarted = await Room.load(t.auctionId, t.deps);
    const screen = await t.connect(restarted, 'screen');
    expect(screen.transport.messages('state').at(-1)?.snapshot).toMatchObject({
      status: 'SETTLING',
    });
  });
});
