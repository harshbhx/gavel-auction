import {
  ManualClock,
  SeqIds,
  add,
  assertGapless,
  type AuctionConfig,
  type AuctionId,
  type BidMsg,
  type BidderId,
  type Cents,
  type ConnId,
  type EngineBidResult,
  type EnginePort,
  type EngineState,
  type EngineView,
  type EpochMs,
  type MsgId,
  type RoomEvent,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/limits/rate-limiter';
import { MemoryTransport } from '../src/room/memory-transport';
import { Room, type Connection, type RoomDeps } from '../src/room/room';
import { MemoryStore } from '../src/store/memory-store';

const START = 1_789_000_000_000;

const config = {
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

/** Plain English-auction engine: enough to exercise the room, not a replacement for the real one. */
class TestEngine implements EnginePort {
  private readonly ceilings = new Map<BidderId, Cents>();
  private price: Cents | null = null;
  private leader: BidderId | null = null;
  private state: EngineState = 'OPEN';

  constructor(private readonly cfg: AuctionConfig) {}

  register(bidder: BidderId, ceiling: Cents): void {
    this.ceilings.set(bidder, ceiling);
  }

  placeBid(bidder: BidderId, amount: Cents, ts: EpochMs): EngineBidResult {
    if (this.state !== 'OPEN' || ts >= this.cfg.endTs) return { ok: false, code: 'closed' };
    const ceiling = this.ceilings.get(bidder);
    if (ceiling === undefined) return { ok: false, code: 'unregistered' };
    if (this.leader === bidder) return { ok: false, code: 'already_leading' };
    if (amount < this.minNext()) {
      return { ok: false, code: this.price === null ? 'below_reserve' : 'below_increment' };
    }
    if (amount > ceiling) return { ok: false, code: 'over_ceiling' };
    this.price = amount;
    this.leader = bidder;
    return { ok: true };
  }

  tick(now: EpochMs): EngineState {
    if (this.state === 'OPEN' && now >= this.cfg.endTs) this.state = 'CLOSING';
    return this.state;
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
    return this.price === null ? this.cfg.reserve : add(this.price, this.cfg.minIncrement);
  }
}

class SpyStore extends MemoryStore {
  constructor(private readonly log: string[]) {
    super();
  }
  override async appendEvents(
    auctionId: AuctionId,
    expectedSeq: number,
    events: RoomEvent[],
  ): Promise<void> {
    await super.appendEvents(auctionId, expectedSeq, events);
    this.log.push(`append:${events[0]?.seq}`);
  }
}

class FlakyStore extends MemoryStore {
  failNext = 0;
  override async appendEvents(
    auctionId: AuctionId,
    expectedSeq: number,
    events: RoomEvent[],
  ): Promise<void> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('disk full');
    }
    return super.appendEvents(auctionId, expectedSeq, events);
  }
}

const setup = async (opts: { store?: MemoryStore; limiter?: boolean } = {}) => {
  const clock = new ManualClock(START);
  const ids = new SeqIds();
  const store = opts.store ?? new MemoryStore(() => clock.now());
  const deps: RoomDeps = {
    store,
    clock,
    ids,
    engine: (cfg) => new TestEngine(cfg),
    ...(opts.limiter ? { limiter: new RateLimiter(clock) } : {}),
  };
  const auctionId = ids.mint<'AuctionId'>();
  const room = await Room.create(auctionId, config, 'auctioneer-sub', deps);
  const b1 = ids.mint<'BidderId'>();
  const b2 = ids.mint<'BidderId'>();
  await room.registerBidder({ bidderId: b1, name: 'Ada', ceiling: 50000 as Cents, holdRef: 'h1' });
  await room.registerBidder({ bidderId: b2, name: 'Bo', ceiling: 30000 as Cents, holdRef: 'h2' });
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
  const bid = (amount: number, mid?: MsgId): BidMsg => ({
    v: 1,
    t: 'bid',
    mid: mid ?? ids.mint<'MsgId'>(),
    amount,
    source: 'qr',
  });
  return { clock, ids, store, deps, auctionId, room, b1, b2, connect, bid };
};

describe('room mailbox and bid pipeline (T-RT-022..026)', () => {
  it('accepts a bid: bid_accepted to the sender, price to everyone, same seq', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    const screen = await t.connect('screen');
    await t.room.submitBid(c1.conn, t.bid(10000));
    const accepted = c1.transport.messages('bid_accepted');
    expect(accepted).toHaveLength(1);
    const prices = [c1, c2, screen].map((c) => c.transport.messages('price'));
    for (const p of prices) {
      expect(p).toHaveLength(1);
      expect(p[0]).toMatchObject({ price: 10000, seq: accepted[0]?.seq, minNext: 10500 });
    }
    expect(c2.transport.messages('bid_accepted')).toHaveLength(0);
  });

  it('appends to the store before sending anything for that seq (R-RT-032)', async () => {
    const log: string[] = [];
    const store = new SpyStore(log);
    const t = await setup({ store });
    const c1 = await t.connect('bidder', t.b1);
    const original = c1.transport.send.bind(c1.transport);
    c1.transport.send = (text: string) => {
      log.push('send');
      original(text);
    };
    log.length = 0;
    await t.room.submitBid(c1.conn, t.bid(10000));
    expect(log[0]).toBe('append:4');
    expect(log.slice(1).every((x) => x === 'send')).toBe(true);
    expect(log.length).toBeGreaterThan(1);
  });

  it('serialises 50 concurrent commands with gapless seq (T-RT-022)', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < 50; i++) {
      jobs.push(t.room.submitBid(i % 2 === 0 ? c1.conn : c2.conn, t.bid(10000 + i * 500)));
    }
    await Promise.all(jobs);
    expect(t.room.maxConcurrent).toBe(1);
    const events = await t.store.readEvents(t.auctionId, 1, 1000);
    expect(events).toHaveLength(53);
    expect(() => assertGapless(events)).not.toThrow();
  });

  it('uses server time at dequeue, not the client timestamp (T-RT-023)', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, { ...t.bid(10000), clientTs: 5 as EpochMs });
    const events = await t.store.readEvents(t.auctionId, 4, 1);
    expect(events[0]?.ts).toBe(START);
  });
});

describe('rejections and privacy (R-RT-035, R-RT-037, R-RT-055)', () => {
  it('rejects over-ceiling to the sender only and hides it from other bidders and screens', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    const screen = await t.connect('screen');
    const boss = await t.connect('auctioneer');
    await t.room.submitBid(c1.conn, t.bid(10000));
    await t.room.submitBid(c2.conn, t.bid(40000));
    expect(c2.transport.messages('bid_rejected')).toMatchObject([{ reason: 'over_ceiling' }]);
    expect(c1.transport.messages('bid_rejected')).toHaveLength(0);
    // The rejected row (which would bound B2's ceiling) goes to the auctioneer only.
    const rejectedAudit = (c: { transport: MemoryTransport }) =>
      c.transport
        .messages('audit_event')
        .filter((m) => (m.audit as { outcome: string }).outcome === 'rejected');
    expect(rejectedAudit(boss)).toHaveLength(1);
    expect(rejectedAudit(c1)).toHaveLength(0);
    expect(rejectedAudit(screen)).toHaveLength(0);
    expect(screen.transport.frames.join('\n')).not.toContain('over_ceiling');
  });

  it('answers a non-integer amount with bad_amount and keeps the socket open (T-RT-027)', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, t.bid(350.5));
    expect(c1.transport.messages('bid_rejected')).toMatchObject([{ reason: 'bad_amount' }]);
    expect(c1.transport.closed).toBeUndefined();
  });

  it('rejects bids from screens and unnamed auctioneer bids as forbidden', async () => {
    const t = await setup();
    const screen = await t.connect('screen');
    const boss = await t.connect('auctioneer');
    await t.room.submitBid(screen.conn, t.bid(10000));
    await t.room.submitBid(boss.conn, t.bid(10000));
    expect(screen.transport.messages('error')).toMatchObject([{ code: 'forbidden' }]);
    expect(boss.transport.messages('error')).toMatchObject([{ code: 'forbidden' }]);
  });

  it('lets the auctioneer bid for a registered bidder as source manual', async () => {
    const t = await setup();
    const boss = await t.connect('auctioneer');
    await t.room.submitBid(boss.conn, { ...t.bid(10000), bidderId: t.b1 });
    const events = await t.store.readEvents(t.auctionId, 4, 1);
    expect(events[0]).toMatchObject({ type: 'bid_accepted', bidderId: t.b1 });
    expect(events[0]).toMatchObject({ audit: { source: 'manual' } });
  });

  it('ignores a client-supplied bidderId from a bidder (R-RT-039)', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, { ...t.bid(10000), bidderId: t.b2 });
    const events = await t.store.readEvents(t.auctionId, 4, 1);
    expect(events[0]).toMatchObject({ bidderId: t.b1 });
  });

  it('sends each viewer only their own ceiling in state snapshots', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    const screen = await t.connect('screen');
    const boss = await t.connect('auctioneer');
    const snap = (c: { transport: MemoryTransport }) =>
      c.transport.messages('state')[0]?.snapshot as Record<string, unknown>;
    expect(snap(c1).you).toEqual({ bidderId: t.b1, ceiling: 50000 });
    expect(snap(c2).you).toEqual({ bidderId: t.b2, ceiling: 30000 });
    expect(snap(screen)).not.toHaveProperty('you');
    expect(snap(boss)).not.toHaveProperty('you');
    expect(c1.transport.frames.join('\n')).not.toContain('"ceiling":30000');
    expect(c2.transport.frames.join('\n')).not.toContain('"ceiling":50000');
    for (const c of [screen, boss]) {
      expect(c.transport.frames.join('\n')).not.toContain('"ceiling"');
    }
  });

  it('rate limits before the mailbox (R-RT-035)', async () => {
    const t = await setup({ limiter: true });
    const c1 = await t.connect('bidder', t.b1);
    for (let i = 0; i < 6; i++) await t.room.submitBid(c1.conn, t.bid(10000));
    const errors = c1.transport.messages('error');
    expect(errors).toMatchObject([{ code: 'rate_limited' }]);
    expect(await t.store.lastSeq(t.auctionId)).toBe(3 + 5);
  });
});

describe('idempotency, failures and restart (T-RT-025, T-RT-026, R-RT-059)', () => {
  it('replays the original reply for a repeated mid, also after restart', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const mid = t.ids.mint<'MsgId'>();
    await t.room.submitBid(c1.conn, t.bid(10000, mid));
    const seqBefore = await t.store.lastSeq(t.auctionId);
    await t.room.submitBid(c1.conn, t.bid(10000, mid));
    const [first, second] = c1.transport.frames.filter((f) => f.includes('"bid_accepted"'));
    expect(second).toBe(first);
    expect(await t.store.lastSeq(t.auctionId)).toBe(seqBefore);

    const restarted = await Room.load(t.auctionId, t.deps);
    const again = await (async () => {
      const transport = new MemoryTransport();
      const conn: Connection = { ...c1.conn, transport };
      await restarted.attach(conn);
      await restarted.submitBid(conn, t.bid(10000, mid));
      return transport.frames.filter((f) => f.includes('"bid_accepted"'));
    })();
    expect(again).toEqual([first]);
    expect(await t.store.lastSeq(t.auctionId)).toBe(seqBefore);
  });

  it('ignores a repeat registration with a higher ceiling and keeps the first hold (D-0023)', async () => {
    const t = await setup();
    const seqBefore = await t.store.lastSeq(t.auctionId);
    await t.room.registerBidder({
      bidderId: t.b1,
      name: 'Ada',
      ceiling: 90000 as Cents,
      holdRef: 'h1-raised',
    });
    expect(await t.store.lastSeq(t.auctionId)).toBe(seqBefore);
    expect(t.room.holdRefs.get(t.b1)).toBe('h1');
    const c1 = await t.connect('bidder', t.b1);
    // The first ceiling (50000) still limits the bidder.
    await t.room.submitBid(c1.conn, t.bid(60000));
    expect(c1.transport.messages('bid_accepted')).toHaveLength(0);
  });

  it('survives a failed append: store_unavailable, no state change, next bid works', async () => {
    const flaky = new FlakyStore();
    const t = await setup({ store: flaky });
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    const before = await flaky.lastSeq(t.auctionId);
    flaky.failNext = 1;
    await t.room.submitBid(c1.conn, t.bid(10000));
    expect(c1.transport.messages('error')).toMatchObject([{ code: 'store_unavailable' }]);
    expect(c2.transport.messages('price')).toHaveLength(0);
    expect(await flaky.lastSeq(t.auctionId)).toBe(before);
    expect(t.room.lastSeq).toBe(before);
    // The engine was rolled back, so the same opening bid is still valid.
    await t.room.submitBid(c1.conn, t.bid(10000));
    expect(c1.transport.messages('bid_accepted')).toHaveLength(1);
    expect(await flaky.lastSeq(t.auctionId)).toBe(before + 1);
  });

  it('rebuilds identical derived state from the log', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    await t.room.submitBid(c1.conn, t.bid(10000));
    await t.room.submitBid(c2.conn, t.bid(10500));
    const restarted = await Room.load(t.auctionId, t.deps);
    const viewer = new MemoryTransport();
    await restarted.attach({ ...c1.conn, id: t.ids.mint<'ConnId'>() as ConnId, transport: viewer });
    const live = new MemoryTransport();
    await t.room.attach({ ...c1.conn, id: t.ids.mint<'ConnId'>() as ConnId, transport: live });
    const pick = (tr: MemoryTransport) => {
      const s = tr.messages('state')[0]?.snapshot as Record<string, unknown>;
      return { price: s.price, leaderId: s.leaderId, minNext: s.minNext, roster: s.roster };
    };
    expect(pick(viewer)).toEqual(pick(live));
    expect(pick(live)).toMatchObject({ price: 10500, leaderId: t.b2 });
  });
});

describe('close timer (R-RT-041, R-RT-043)', () => {
  it('moves to CLOSING at endTs, broadcasts state, and then rejects bids as closed', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, t.bid(10000));
    t.clock.set(config.endTs - 1);
    await t.room.submitBid(c1.conn, t.bid(10500));
    expect(c1.transport.messages('bid_rejected')[0]).toMatchObject({ reason: 'already_leading' });
    t.clock.set(config.endTs);
    await t.room.close();
    const states = c1.transport.messages('state');
    expect(states.at(-1)?.snapshot).toMatchObject({ status: 'CLOSING' });
    const c2 = await t.connect('bidder', t.b2);
    await t.room.submitBid(c2.conn, t.bid(20000));
    expect(c2.transport.messages('bid_rejected')).toMatchObject([{ reason: 'closed' }]);
  });
});

describe('round 2 blocking fixes (RT2)', () => {
  it('refuses a registration the wire cannot carry, so state frames keep flowing (R-RT-054)', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const before = await t.store.lastSeq(t.auctionId);
    const bad = t.ids.mint<'BidderId'>();
    const base = { bidderId: bad, holdRef: 'h' };
    await expect(
      t.room.registerBidder({ ...base, name: 'x'.repeat(65), ceiling: 50000 as Cents }),
    ).rejects.toMatchObject({ code: 'bad_message' });
    await expect(
      t.room.registerBidder({ ...base, name: 'Cy', ceiling: 1.5 as Cents }),
    ).rejects.toMatchObject({ code: 'bad_message' });
    await expect(
      t.room.registerBidder({ ...base, name: 'Cy', ceiling: 50000 as Cents, holdRef: '' }),
    ).rejects.toMatchObject({ code: 'bad_message' });
    expect(await t.store.lastSeq(t.auctionId)).toBe(before);
    const states = c1.transport.messages('state').length;
    const c2 = await t.connect('bidder', t.b2);
    expect(c2.transport.messages('state')).toHaveLength(1);
    expect(c1.transport.messages('state').length).toBe(states);
    expect(t.room.encodeFailures).toBe(0);
  });

  it('sends other clients a snapshot when someone registers, so seq has no gap (R-RT-036)', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const screen = await t.connect('screen');
    const n = t.ids.mint<'BidderId'>();
    await t.room.registerBidder({
      bidderId: n,
      name: 'Di',
      ceiling: 40000 as Cents,
      holdRef: 'h3',
    });
    const seq = t.room.lastSeq;
    expect(c1.transport.messages('state').at(-1)?.seq).toBe(seq);
    expect(screen.transport.messages('state').at(-1)?.seq).toBe(seq);
  });

  it('answers internal and rebuilds when the engine throws on a bid (R-RT-033)', async () => {
    let boom = true;
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const engine = (t.room as unknown as { engine: EnginePort }).engine;
    const real = engine.placeBid.bind(engine);
    engine.placeBid = (...args) => {
      if (boom) {
        boom = false;
        throw new Error('engine exploded');
      }
      return real(...args);
    };
    await t.room.submitBid(c1.conn, t.bid(10000));
    expect(c1.transport.messages('error')).toMatchObject([{ code: 'internal' }]);
    await t.room.submitBid(c1.conn, t.bid(10000));
    expect(c1.transport.messages('bid_accepted')).toHaveLength(1);
  });

  it('does not raise an unhandled rejection when the timer body throws (R-RT-041)', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    c1.transport.send = () => {
      throw new Error('socket closed');
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => {
      unhandled.push(e);
    };
    process.on('unhandledRejection', onUnhandled);
    t.clock.set(config.endTs);
    await t.room.close().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 10));
    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
  });

  it('keeps every viewer gapless after a private rejection (R-RT-036)', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    const screen = await t.connect('screen');
    await t.room.submitBid(c1.conn, t.bid(10000));
    await t.room.submitBid(c2.conn, t.bid(40000)); // over ceiling, private to c2
    await t.room.submitBid(c2.conn, t.bid(10500));
    for (const c of [c1, c2, screen]) {
      const seqs = [
        ...new Set(c.transport.messages().map((m) => m.seq as number | undefined)),
      ].filter((n): n is number => n !== undefined);
      const ordered = seqs.slice().sort((a, b) => a - b);
      for (let i = 1; i < ordered.length; i++) {
        expect(ordered[i]).toBeLessThanOrEqual((ordered[i - 1] ?? 0) + 1);
      }
      expect(ordered.at(-1)).toBe(t.room.lastSeq);
    }
  });
});

describe('round 3 blocking fixes (RT3)', () => {
  class CappedEngine extends TestEngine {
    override register(bidder: BidderId, ceiling: Cents): void {
      if (ceiling > 100_000_000) throw new Error('bad_ceiling');
      super.register(bidder, ceiling);
    }
  }

  it('does not store a registration the engine refuses, so replay still loads (SERVICE-R3-01)', async () => {
    const clock = new ManualClock(START);
    const ids = new SeqIds();
    const store = new MemoryStore(() => clock.now());
    const deps: RoomDeps = { store, clock, ids, engine: (cfg) => new CappedEngine(cfg) };
    const auctionId = ids.mint<'AuctionId'>();
    const room = await Room.create(auctionId, config, 'auctioneer-sub', deps);
    const ok = ids.mint<'BidderId'>();
    await room.registerBidder({
      bidderId: ok,
      name: 'Ada',
      ceiling: 50000 as Cents,
      holdRef: 'h1',
    });
    const before = await store.lastSeq(auctionId);
    const huge = ids.mint<'BidderId'>();
    await expect(
      room.registerBidder({
        bidderId: huge,
        name: 'Big',
        ceiling: 150_000_000 as Cents,
        holdRef: 'h2',
      }),
    ).rejects.toMatchObject({ code: 'bad_message' });
    expect(await store.lastSeq(auctionId)).toBe(before);
    // The room keeps working and the log still replays.
    const late = ids.mint<'BidderId'>();
    await room.registerBidder({
      bidderId: late,
      name: 'Cy',
      ceiling: 40000 as Cents,
      holdRef: 'h3',
    });
    const reloaded = await Room.load(auctionId, deps);
    expect(reloaded.lastSeq).toBe(room.lastSeq);
  });

  it('skips an already stored registration the engine refuses instead of failing the load (SERVICE-R3-01)', async () => {
    const clock = new ManualClock(START);
    const ids = new SeqIds();
    const store = new MemoryStore(() => clock.now());
    const lax: RoomDeps = { store, clock, ids, engine: (cfg) => new TestEngine(cfg) };
    const auctionId = ids.mint<'AuctionId'>();
    const room = await Room.create(auctionId, config, 'auctioneer-sub', lax);
    await room.registerBidder({
      bidderId: ids.mint<'BidderId'>(),
      name: 'Big',
      ceiling: 150_000_000 as Cents,
      holdRef: 'h2',
    });
    const strict: RoomDeps = { ...lax, engine: (cfg) => new CappedEngine(cfg) };
    const reloaded = await Room.load(auctionId, strict);
    expect(reloaded.lastSeq).toBe(room.lastSeq);
  });
});

describe('registration announcement (R4-V09)', () => {
  it('tells the bidder even when the ledger write after the log append fails', async () => {
    const t = await setup();
    let down = true;
    const loaded = await Room.load(t.auctionId, {
      ...t.deps,
      durable: async () => {
        if (down) throw new Error('ledger down');
      },
    });
    const id = t.ids.mint<'BidderId'>();
    const transport = new MemoryTransport();
    await loaded.attach({
      id: t.ids.mint<'ConnId'>() as ConnId,
      role: 'bidder',
      sub: id,
      transport,
      bidderId: id,
    });
    const reg = { bidderId: id, name: 'Cy', ceiling: 30000 as Cents, holdRef: 'h3' };
    await expect(loaded.registerBidder(reg)).rejects.toThrow('ledger down');
    expect(transport.messages('registered')).toHaveLength(1);

    down = false;
    await loaded.registerBidder(reg);
    expect(transport.messages('registered')).toHaveLength(1);
  });
});

class DownStore extends MemoryStore {
  down = false;
  override async appendEvents(
    auctionId: AuctionId,
    expectedSeq: number,
    events: RoomEvent[],
  ): Promise<void> {
    if (this.down) throw new Error('store down');
    return super.appendEvents(auctionId, expectedSeq, events);
  }
  override async readEvents(
    auctionId: AuctionId,
    fromSeq: number,
    limit: number,
  ): Promise<RoomEvent[]> {
    if (this.down) throw new Error('store down');
    return super.readEvents(auctionId, fromSeq, limit);
  }
}

describe('red-team round 4 (RT-01)', () => {
  it('ends the lot after the store comes back, with no command in between (R4-V05)', async () => {
    const store = new DownStore();
    const t = await setup({ store });
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    await t.room.submitBid(c1.conn, t.bid(10000));

    // A failed append whose rebuild also fails leaves the room dirty.
    store.down = true;
    await t.room.submitBid(c2.conn, t.bid(10500));
    t.clock.set(config.endTs);
    await t.connect('screen');
    store.down = false;
    t.clock.set(config.endTs + 2_000);
    await t.connect('screen');

    const types = (await store.readEvents(t.auctionId, 1, 1000)).map((e) => e.type);
    expect(types).toContain('state_changed');
  });

  it('refuses commands and arms nothing once the host is fenced (R4-V02)', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    t.room.stop();
    await t.room.submitBid(c1.conn, t.bid(10000));
    expect(c1.transport.messages('error')).toMatchObject([{ code: 'host_fenced' }]);
    t.clock.set(config.endTs + 1);
    await t.connect('screen');
    const types = (await t.store.readEvents(t.auctionId, 1, 1000)).map((e) => e.type);
    expect(types).not.toContain('state_changed');
  });
});
