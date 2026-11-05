import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type AuctionId,
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
import { MemoryTransport } from '../src/room/memory-transport';
import { Room, type Connection } from '../src/room/room';
import { MemoryStore } from '../src/store/memory-store';
import { config, START } from './room-harness';

class StubEngine implements EnginePort {
  price: Cents | null = null;
  leader: BidderId | null = null;
  state: EngineState = 'OPEN';
  ticks = 0;
  constructor(
    private readonly cfg: AuctionConfig,
    private readonly bidResult: () => unknown,
    private readonly tickHook: (now: EpochMs, self: StubEngine) => void,
  ) {}
  register(): void {}
  placeBid(bidder: BidderId, amount: Cents): EngineBidResult {
    const res = this.bidResult();
    this.price = amount;
    this.leader = bidder;
    return res as EngineBidResult;
  }
  tick(now: EpochMs): EngineState {
    this.ticks += 1;
    this.tickHook(now, this);
    return this.state;
  }
  view(): EngineView {
    return {
      state: this.state,
      price: this.price,
      leader: this.leader,
      endTs: this.cfg.endTs,
      extensions: 0,
      minNext: (this.price ?? this.cfg.reserve) as Cents,
    };
  }
}

class DownableStore extends MemoryStore {
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
    from: number,
    limit: number,
  ): Promise<RoomEvent[]> {
    if (this.down) throw new Error('store down');
    return super.readEvents(auctionId, from, limit);
  }
}

const build = async (
  bidResult: () => unknown,
  tickHook: (now: EpochMs, self: StubEngine) => void = (now, self) => {
    if (now >= config.endTs) self.state = 'CLOSING';
  },
) => {
  const clock = new ManualClock(START);
  const ids = new SeqIds();
  const store = new DownableStore(() => clock.now());
  const auctionId = ids.mint<'AuctionId'>();
  const room = await Room.create(auctionId, config, 'auctioneer-sub', {
    store,
    clock,
    ids,
    engine: (cfg) => new StubEngine(cfg, bidResult, tickHook),
  });
  const b1 = ids.mint<'BidderId'>();
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
    mid: ids.mint<'MsgId'>() as MsgId,
    amount,
    source: 'qr' as const,
  });
  const events = () => store.readEvents(auctionId, 1, 1000);
  return { clock, store, room, b1, connect, bid, events };
};

describe('a malformed engine result is a rejection, not a crash (#956)', () => {
  it('does not persist a bid_accepted for the legacy result shape', async () => {
    const t = await build(() => ({ price: 12000, leader: 'x', endTs: START + 1 }));
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, t.bid(12000));
    const types = (await t.events()).map((e) => e.type);
    expect(types).not.toContain('bid_accepted');
    expect(c1.transport.messages('bid_accepted')).toHaveLength(0);
    expect(c1.transport.messages('error')).toMatchObject([{ code: 'internal' }]);
  });

  it('treats an unknown rejection code as internal', async () => {
    const t = await build(() => ({ ok: false, code: 'bogus' }));
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, t.bid(12000));
    expect(c1.transport.messages('error')).toMatchObject([{ code: 'internal' }]);
    expect((await t.events()).map((e) => e.type)).not.toContain('bid_accepted');
  });
});

describe('nothing is derived from an engine ahead of the store (#957)', () => {
  it('sends an error instead of a phantom price to a joining connection', async () => {
    const t = await build(() => ({ ok: true }));
    const c1 = await t.connect('bidder', t.b1);
    t.store.down = true;
    await t.room.submitBid(c1.conn, t.bid(12000));
    const late = await t.connect('screen');
    expect(late.transport.messages('state')).toHaveLength(0);
    expect(late.transport.messages('error')).toMatchObject([{ code: 'store_unavailable' }]);
  });

  it('broadcasts fresh state to every connection after recovery', async () => {
    const t = await build(() => ({ ok: true }));
    const c1 = await t.connect('bidder', t.b1);
    const screen = await t.connect('screen');
    t.store.down = true;
    await t.room.submitBid(c1.conn, t.bid(12000));
    t.store.down = false;
    const before = screen.transport.messages('state').length;
    await t.room.submitBid(c1.conn, t.bid(13000));
    expect(screen.transport.messages('state').length).toBeGreaterThan(before);
  });
});
