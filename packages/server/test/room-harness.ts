import {
  ManualClock,
  SeqIds,
  add,
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
import { RateLimiter } from '../src/limits/rate-limiter';
import { MemoryTransport } from '../src/room/memory-transport';
import { Room, type Connection, type RoomDeps } from '../src/room/room';
import { MemoryStore } from '../src/store/memory-store';

export const START = 1_789_000_000_000;

export const config = {
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

export class SpyStore extends MemoryStore {
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

export class FlakyStore extends MemoryStore {
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

export const setup = async (
  opts: { store?: MemoryStore; limiter?: boolean; metrics?: RoomDeps['metrics'] } = {},
) => {
  const clock = new ManualClock(START);
  const ids = new SeqIds();
  const store = opts.store ?? new MemoryStore(() => clock.now());
  const deps: RoomDeps = {
    store,
    clock,
    ids,
    engine: (cfg) => new TestEngine(cfg),
    ...(opts.limiter ? { limiter: new RateLimiter(clock) } : {}),
    ...(opts.metrics ? { metrics: opts.metrics } : {}),
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
