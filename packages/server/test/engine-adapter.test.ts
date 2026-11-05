import {
  ERROR_CODES,
  SeqIds,
  type AuctionConfig,
  type AuctionId,
  type BidderId,
  type Cents,
  type EnginePort,
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

/** Small deterministic generator, so a failure repeats. */
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

describe('EngineAdapter drives @gavel/engine through EnginePort (T-RT-108)', () => {
  it('maps every rejection to a wire code and keeps view() equal to the accepted bids', () => {
    const ids = new SeqIds();
    const auctionId = ids.mint<'AuctionId'>() as AuctionId;
    const engine: EnginePort = new LedgerEngine(auctionId, config, START as EpochMs);
    const bidders = [
      ids.mint<'BidderId'>() as BidderId,
      ids.mint<'BidderId'>() as BidderId,
      ids.mint<'BidderId'>() as BidderId,
    ];
    const ceilings = [30000, 45000, 60000];
    bidders.forEach((b, i) => engine.register(b, ceilings[i] as Cents));

    const next = rng(108);
    const codes = new Set<string>();
    let price: number | null = null;
    let leader: BidderId | null = null;

    for (let i = 0; i < 100; i++) {
      const who = Math.floor(next() * bidders.length);
      const bidder = bidders[who] as BidderId;
      const amount = (5000 + Math.floor(next() * 600) * 100) as Cents;
      const res = engine.placeBid(bidder, amount, (START + 1000 + i * 10) as EpochMs);
      if (res.ok) {
        price = amount;
        leader = bidder;
      } else {
        expect(ERROR_CODES).toContain(res.code);
        codes.add(res.code);
      }
      const view = engine.view();
      expect(view.state).toBe('OPEN');
      expect(view.price).toBe(price);
      expect(view.leader).toBe(leader);
      expect(view.minNext).toBe(price === null ? config.reserve : price + config.minIncrement);
    }
    expect(price).not.toBeNull();
    expect(codes.size).toBeGreaterThan(0);
  });
});
