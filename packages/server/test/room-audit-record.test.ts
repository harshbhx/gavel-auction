import type { BidMsg, BidderId, Cents, EngineBidResult, EpochMs, RoomEvent } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import type { BidMeta } from '../src/room/settle-port';
import { Room } from '../src/room/room';
import { TestEngine, acceptLatestConfirm, setup } from './room-harness';

/** A test engine that also records the audit fields the room hands to the ledger. */
class MetaEngine extends TestEngine {
  readonly metas: BidMeta[] = [];
  placeBidWith(bidder: BidderId, amount: Cents, ts: EpochMs, meta: BidMeta): EngineBidResult {
    this.metas.push(meta);
    return this.placeBid(bidder, amount, ts);
  }
}

const spoken = (mid: BidMsg['mid'], amount: number, confidence: number): BidMsg => ({
  v: 1,
  t: 'bid',
  mid,
  amount,
  source: 'voice',
  transcript: 'twelve thousand',
  confidence,
  audioTsMs: 4200,
  audioEndMs: 5100,
});

const auditOf = (e: RoomEvent | undefined) =>
  e !== undefined && 'audit' in e ? (e.audit as Record<string, unknown>) : undefined;

describe('per-bid audit record (issue 710, docs/PLAN.md 2.4)', () => {
  it('keeps the audio start and end through a confirm, in the log and in the ledger', async () => {
    let engine: MetaEngine | undefined;
    const t = await setup({
      engine: (cfg) => {
        engine = new MetaEngine(cfg);
        return engine;
      },
    });
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, spoken(t.ids.mint<'MsgId'>(), 12000, 0.62));
    await acceptLatestConfirm(t.room, c1);

    const events = await t.store.readEvents(t.auctionId, 1, 100);
    const asked = events.find((e) => e.type === 'confirm_requested');
    expect(auditOf(asked)).toMatchObject({ audioTsMs: 4200, audioEndMs: 5100 });
    const resolved = events.find((e) => e.type === 'confirm_resolved');
    expect(auditOf(resolved)).toMatchObject({ audioTsMs: 4200, audioEndMs: 5100 });
    const accepted = events.find((e) => e.type === 'bid_accepted');
    expect(auditOf(accepted)).toMatchObject({
      audioTsMs: 4200,
      audioEndMs: 5100,
      confirmed: true,
      parsedAmount: 12000,
    });
    expect(engine?.metas.at(-1)).toMatchObject({
      source: 'voice',
      confirmed: true,
      audioStartMs: 4200,
      audioEndMs: 5100,
      parsedCents: 12000,
    });
  });

  it('hands the audio span and the parsed amount of a direct voice bid to the ledger', async () => {
    let engine: MetaEngine | undefined;
    const t = await setup({
      engine: (cfg) => {
        engine = new MetaEngine(cfg);
        return engine;
      },
    });
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, spoken(t.ids.mint<'MsgId'>(), 12000, 0.97));
    expect(engine?.metas.at(-1)).toMatchObject({
      source: 'voice',
      audioStartMs: 4200,
      audioEndMs: 5100,
      parsedCents: 12000,
    });
  });

  it('gives the same audit fields to the engine when the room is rebuilt from its log', async () => {
    const engines: MetaEngine[] = [];
    const t = await setup({
      engine: (cfg) => {
        const e = new MetaEngine(cfg);
        engines.push(e);
        return e;
      },
    });
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, spoken(t.ids.mint<'MsgId'>(), 12000, 0.97));
    const live = engines.at(-1)?.metas.at(-1);
    await Room.load(t.auctionId, t.deps);
    expect(engines.at(-1)?.metas.at(-1)).toEqual(live);
  });
});
