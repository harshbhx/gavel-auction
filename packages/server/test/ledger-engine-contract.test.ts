import {
  SeqIds,
  type AuctionConfig,
  type AuctionId,
  type BidderId,
  type Cents,
  type EpochMs,
} from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { LedgerEngine } from '../src/runtime/ledger-engine';

const START = 1_789_000_000_000;

const config = {
  mode: 'english',
  currency: 'USD',
  reserve: 10000,
  minIncrement: 500,
  endTs: START + 3_600_000,
  softCloseWindowMs: 30_000,
  softCloseExtensionMs: 30_000,
  maxExtensions: 5,
  ceilingPresets: [50000],
  confirmConfidenceThreshold: 0.85,
} as unknown as AuctionConfig;

function make(maxCeilingCents?: number): { engine: LedgerEngine; bidder: BidderId } {
  const ids = new SeqIds();
  const auctionId = ids.mint<'AuctionId'>() as AuctionId;
  const bidder = ids.mint<'BidderId'>() as BidderId;
  return { engine: new LedgerEngine(auctionId, config, START as EpochMs, maxCeilingCents), bidder };
}

describe('LedgerEngine ledger contract (R6-D03, R6-B01)', () => {
  it('writes accepted bids to the ledger with the sent source and no entry for a rejected bid', () => {
    const { engine, bidder } = make();
    engine.register(bidder, 40000 as Cents);
    const before = engine.commands.length;
    const rejected = engine.placeBid(bidder, 100 as Cents, (START + 1000) as EpochMs);
    expect(rejected.ok).toBe(false);
    expect(engine.commands.length).toBe(before);
    const accepted = engine.placeBidWith(bidder, 10000 as Cents, (START + 2000) as EpochMs, {
      source: 'qr',
    });
    expect(accepted.ok).toBe(true);
    const last = engine.commands.at(-1);
    expect(last?.type).toBe('PlaceBid');
    expect(last).toMatchObject({ source: 'qr' });
  });

  it('enforces the configured maximum ceiling in the engine', () => {
    const capped = make(25000);
    expect(() => capped.engine.register(capped.bidder, 30000 as Cents)).toThrow();
    capped.engine.register(capped.bidder, 25000 as Cents);
    const open = make();
    open.engine.register(open.bidder, 30000 as Cents);
  });
});
