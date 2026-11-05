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
  type RoomEvent,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { MemoryTransport } from '../src/room/memory-transport';
import { Room, type Connection, type RoomDeps } from '../src/room/room';
import type { HammerEnginePort, HammerResult } from '../src/room/settle-port';
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

/** Small seeded generator so a failing interleaving can be replayed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const build = async () => {
  const clock = new ManualClock(START);
  const ids = new SeqIds();
  const store = new MemoryStore(() => clock.now());
  const settled: HammerResult[] = [];
  const deps: RoomDeps = {
    store,
    clock,
    ids,
    engine: (cfg) => new HammerEngine(cfg),
    settle: {
      settle: async (_id, outcome) => {
        settled.push(outcome);
      },
    },
  };
  const auctionId = ids.mint<'AuctionId'>();
  const room = await Room.create(auctionId, config, 'auctioneer-sub', deps);
  const bidders = [ids.mint<'BidderId'>(), ids.mint<'BidderId'>()];
  for (const [i, bidderId] of bidders.entries()) {
    await room.registerBidder({
      bidderId,
      name: `B${i}`,
      ceiling: 50000 as Cents,
      holdRef: `h${i}`,
    });
  }
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
  const events = (): Promise<RoomEvent[]> => store.readEvents(auctionId, 1, 10_000);
  return { clock, store, room, bidders, connect, bid, events, settled };
};

const gapless = (evs: RoomEvent[]) => evs.every((e, i) => e.seq === i + 1);

describe('race: bid vs hammer (T-RT-106)', () => {
  it('1000 random interleavings: a bid is either in the outcome or closed, never half-applied', async () => {
    for (let seed = 1; seed <= 1000; seed += 1) {
      const next = rng(seed);
      const t = await build();
      const b1 = await t.connect('bidder', t.bidders[0]);
      const b2 = await t.connect('bidder', t.bidders[1]);
      const boss = await t.connect('auctioneer');
      const bidCount = 1 + Math.floor(next() * 4);
      const bids = Array.from({ length: bidCount }, (_, i) => ({
        amount: 10000 + i * 500,
        who: i % 2 === 0 ? b1 : b2,
      }));
      const ops: Array<() => Promise<void>> = bids.map(
        (b) => () => t.room.submitBid(b.who.conn, t.bid(b.amount)),
      );
      ops.push(() =>
        t.room.control(boss.conn, {
          controlId: `c${seed}`,
          action: 'hammer',
          args: { closeNow: 1 },
        }),
      );
      await Promise.all(shuffle(ops, next).map((op) => op()));

      const evs = await t.events();
      const ctx = `seed ${seed}`;
      expect(gapless(evs), ctx).toBe(true);
      const hammerAt = evs.findIndex((e) => e.type === 'hammered');
      expect(hammerAt, ctx).toBeGreaterThan(-1);
      expect(
        evs.filter((e) => e.type === 'hammered'),
        ctx,
      ).toHaveLength(1);
      const accepted = evs.filter((e) => e.type === 'bid_accepted');
      const before = accepted.filter((e) => e.seq < (evs[hammerAt] as RoomEvent).seq);
      expect(accepted.length, ctx).toBe(before.length);
      const hammered = evs[hammerAt];
      if (hammered?.type !== 'hammered') throw new Error('unreachable');
      const top = before.reduce(
        (m, e) => (e.type === 'bid_accepted' ? Math.max(m, e.amount) : m),
        0,
      );
      expect(hammered.price, ctx).toBe(top);
      // Every bid got exactly one answer: accepted in the log, or rejected as closed.
      const rejected = [b1, b2].flatMap((c) => c.transport.messages('bid_rejected'));
      expect(accepted.length + rejected.length, ctx).toBe(bidCount);
      for (const r of rejected)
        expect(['closed', 'already_leading', 'below_increment'], ctx).toContain(r.reason);
      expect(t.settled, ctx).toHaveLength(1);
    }
  }, 120_000);
});

describe('race: settling interleavings (T-RT-107)', () => {
  it('rejects a bid during SETTLING as closed', async () => {
    const t = await build();
    const b1 = await t.connect('bidder', t.bidders[0]);
    const boss = await t.connect('auctioneer');
    await t.room.submitBid(b1.conn, t.bid(10000));
    await t.room.control(boss.conn, { controlId: 'c1', action: 'hammer', args: { closeNow: 1 } });
    await t.room.submitBid(b1.conn, t.bid(20000));
    expect(b1.transport.messages('bid_rejected')).toMatchObject([{ reason: 'closed' }]);
  });

  it('keeps seq gapless when settlement updates and bids interleave', async () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const next = rng(seed);
      const t = await build();
      const b1 = await t.connect('bidder', t.bidders[0]);
      const b2 = await t.connect('bidder', t.bidders[1]);
      const boss = await t.connect('auctioneer');
      await t.room.submitBid(b1.conn, t.bid(10000));
      await t.room.control(boss.conn, { controlId: 'c1', action: 'hammer', args: { closeNow: 1 } });
      const per = {
        [t.bidders[0] as string]: 'CAPTURING',
        [t.bidders[1] as string]: 'VOIDING',
      } as const;
      const ops: Array<() => Promise<void>> = [
        () => t.room.reportSettlement({ rev: 1, auctionState: 'WINNER_SELECTED', perBidder: per }),
        () => t.room.reportSettlement({ rev: 2, auctionState: 'CAPTURING', perBidder: per }),
        () => t.room.submitBid(b2.conn, t.bid(10500)),
        () => t.room.submitBid(b1.conn, t.bid(11000)),
      ];
      await Promise.all(shuffle(ops, next).map((op) => op()));
      const evs = await t.events();
      expect(gapless(evs), `seed ${seed}`).toBe(true);
      expect(
        evs.filter((e) => e.type === 'bid_accepted'),
        `seed ${seed}`,
      ).toHaveLength(1);
      const revs = evs.flatMap((e) => (e.type === 'settlement_update' ? [e.rev] : []));
      expect(
        [...revs].sort((x, y) => x - y),
        `seed ${seed}`,
      ).toEqual(revs);
    }
  }, 60_000);
});
