import {
  SeqIds,
  type AuctionConfig,
  type AuctionId,
  type BidderId,
  type Cents,
  type EpochMs,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { LedgerEngine } from '../../src/runtime/ledger-engine';

const NOW = 1_789_000_000_000 as EpochMs;

const config = {
  mode: 'english',
  currency: 'USD',
  reserve: 10000,
  minIncrement: 500,
  endTs: NOW + 600_000,
  softCloseWindowMs: 30_000,
  softCloseExtensionMs: 30_000,
  maxExtensions: 5,
  ceilingPresets: [30000, 50000],
  confirmConfidenceThreshold: 0.85,
} as unknown as AuctionConfig;

function build(createdAt: EpochMs = NOW) {
  const ids = new SeqIds();
  const auctionId = ids.mint<'AuctionId'>() as AuctionId;
  const bidder = ids.mint<'BidderId'>() as BidderId;
  const engine = new LedgerEngine(auctionId, config, createdAt);
  engine.register(bidder, 50000 as Cents);
  return { engine, bidder, ids };
}

describe('ledger engine timeline (INT-R3-13)', () => {
  it('stamps the setup with the room creation time, not a day earlier', () => {
    const { engine } = build();
    const setup = engine.commands.slice(0, 3);
    expect(setup.map((c) => c.type)).toEqual(['CreateAuction', 'AddLot', 'OpenLot']);
    for (const c of setup) expect(c.at).toBe(NOW);
    const add = engine.commands[1];
    expect(add?.type === 'AddLot' ? add.lot.durationMs : 0).toBe(600_000);
    expect(engine.view().endTs).toBe(config.endTs);
  });

  it('keeps the end time when the room is created within a second of it', () => {
    const late = new LedgerEngine(
      new SeqIds().mint<'AuctionId'>() as AuctionId,
      config,
      (config.endTs - 10) as EpochMs,
    );
    expect(late.view().endTs).toBe(config.endTs);
  });

  it('keeps the source and audit fields of a bid in the ledger', () => {
    const { engine, bidder } = build();
    const res = engine.placeBidWith(bidder, 10000 as Cents, (NOW + 1000) as EpochMs, {
      source: 'voice',
      transcript: 'ten thousand',
      confidence: 0.9,
    });
    expect(res).toEqual({ ok: true });
    const cmd = engine.commands.at(-1);
    expect(cmd).toMatchObject({
      type: 'PlaceBid',
      source: 'voice',
      audit: { transcript: 'ten thousand', confidenceBps: 9000 },
    });
  });
});

describe('ledger engine confirm gate (R6-C01)', () => {
  it('refuses a low-confidence voice bid that nobody confirmed', () => {
    const { engine, bidder } = build();
    const res = engine.placeBidWith(bidder, 10000 as Cents, (NOW + 1000) as EpochMs, {
      source: 'voice',
      confidence: 0.05,
    });
    expect(res.ok).toBe(false);
  });

  it('refuses a voice bid that arrives with no confidence (R7-03)', () => {
    const { engine, bidder } = build();
    const res = engine.placeBidWith(bidder, 10000 as Cents, (NOW + 1000) as EpochMs, {
      source: 'voice',
    });
    expect(res.ok).toBe(false);
  });

  it('ignores a confidence sent with a qr bid', () => {
    const { engine, bidder } = build();
    const res = engine.placeBidWith(bidder, 10000 as Cents, (NOW + 1000) as EpochMs, {
      source: 'qr',
      confidence: 0.05,
    });
    expect(res).toEqual({ ok: true });
  });
});

describe('ledger engine same-millisecond bids (INT-R3-14)', () => {
  it('rejects a repeated bid of the same millisecond instead of counting it', () => {
    const { engine, bidder } = build();
    const ts = (NOW + 1000) as EpochMs;
    expect(engine.placeBid(bidder, 10000 as Cents, ts)).toEqual({ ok: true });
    const again = engine.placeBid(bidder, 10000 as Cents, ts);
    expect(again.ok).toBe(false);
    expect(engine.commands.filter((c) => c.type === 'PlaceBid')).toHaveLength(1);
  });

  it('builds the same commands again from the same bids', () => {
    const one = build();
    const two = build();
    for (const { engine, bidder } of [one, two]) {
      engine.placeBid(bidder, 10000 as Cents, (NOW + 1000) as EpochMs);
      engine.placeBid(bidder, 10000 as Cents, (NOW + 1000) as EpochMs);
      engine.placeBid(bidder, 11000 as Cents, (NOW + 1000) as EpochMs);
    }
    const ids = (e: LedgerEngine): string[] => e.commands.map((c) => c.commandId);
    expect(ids(one.engine)).toEqual(ids(two.engine));
  });
});
