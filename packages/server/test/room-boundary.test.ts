import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type BidderId,
  type Cents,
  type ConnId,
  type EpochMs,
  type MsgId,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { MemoryTransport } from '../src/room/memory-transport';
import { Room, type Connection } from '../src/room/room';
import { LedgerEngine } from '../src/runtime/ledger-engine';
import { MemoryStore } from '../src/store/memory-store';
import { START, config, setup } from './room-harness';

describe('close boundary under ManualClock (R-RT-043, T-RT-034)', () => {
  it('accepts a bid at endTs - 1 and rejects one at endTs as closed', async () => {
    const t = await setup();
    const a = await t.connect('bidder', t.b1);
    const b = await t.connect('bidder', t.b2);
    t.clock.set((config.endTs - 1) as EpochMs);
    await t.room.submitBid(a.conn, t.bid(10000));
    expect(a.transport.messages('bid_rejected')).toHaveLength(0);
    expect(t.room.activeEngine?.view().price).toBe(10000);

    t.clock.set(config.endTs);
    await t.room.submitBid(b.conn, t.bid(10500));
    expect(b.transport.messages('bid_rejected')).toMatchObject([{ reason: 'closed' }]);
    expect(t.room.activeEngine?.view().price).toBe(10000);
  });

  it('extends on a bid at endTs - 1 with soft close and still closes at the old endTs + extension', async () => {
    const endTs = START + 10_000;
    const cfg = {
      mode: 'english',
      currency: 'USD',
      reserve: 10000,
      minIncrement: 500,
      endTs,
      softCloseWindowMs: 5000,
      softCloseExtensionMs: 10_000,
      maxExtensions: 2,
      ceilingPresets: [50000],
      confirmConfidenceThreshold: 0.85,
    } as unknown as AuctionConfig;
    const clock = new ManualClock(START);
    const ids = new SeqIds();
    const store = new MemoryStore(() => clock.now());
    const auctionId = ids.mint<'AuctionId'>();
    const room = await Room.create(auctionId, cfg, 'auctioneer-sub', {
      store,
      clock,
      ids,
      engine: (c, createdAt) => new LedgerEngine(auctionId, c, createdAt),
    });
    const b1 = ids.mint<'BidderId'>() as BidderId;
    const b2 = ids.mint<'BidderId'>() as BidderId;
    await room.registerBidder({
      bidderId: b1,
      name: 'Ada',
      ceiling: 50000 as Cents,
      holdRef: 'h1',
    });
    await room.registerBidder({ bidderId: b2, name: 'Bo', ceiling: 50000 as Cents, holdRef: 'h2' });
    const connect = async (bidderId: BidderId) => {
      const transport = new MemoryTransport();
      const conn: Connection = {
        id: ids.mint<'ConnId'>() as ConnId,
        role: 'bidder',
        sub: bidderId,
        transport,
        bidderId,
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
    const a = await connect(b1);
    const b = await connect(b2);

    clock.set((endTs - 1) as EpochMs);
    await room.submitBid(a.conn, bid(10000));
    expect(a.transport.messages('price').at(-1)).toMatchObject({
      price: 10000,
      endTs: endTs - 1 + 10_000,
      extensions: 1,
    });

    // The original endTs passes inside the extension: still open, the bid is accepted.
    clock.set(endTs);
    await room.submitBid(b.conn, bid(10500));
    expect(b.transport.messages('bid_rejected')).toHaveLength(0);
    expect(room.activeEngine?.view().price).toBe(10500);
  });
});
