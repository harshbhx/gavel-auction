import { describe, expect, it } from 'vitest';
import { RoomEventSchema, assertGapless } from '../src/events';
import { GavelError } from '../src/errors';

const A = '01J9ZQ4Y6Z8K3M5N7P9R1S3T5V';
const B = '01J9ZQ3A0B2C4D6F8H0J2K4M6N';
const BID = '01J9ZQ5C0B2C4D6F8H0J2K4M6N';
const MID = '01J9ZQ6A0B2C4D6F8H0J2K4M6N';
const TS = 1789000000000;

const audit = {
  bidId: BID,
  bidderId: B,
  source: 'qr',
  outcome: 'accepted',
  serverTs: TS,
  seq: 3,
};

const config = {
  mode: 'english',
  currency: 'USD',
  reserve: 10000,
  minIncrement: 500,
  endTs: TS + 600000,
  softCloseWindowMs: 30000,
  softCloseExtensionMs: 30000,
  maxExtensions: 5,
  ceilingPresets: [20000, 50000],
  confirmConfidenceThreshold: 0.8,
};

const at = (seq: number) => ({ auctionId: A, seq, ts: TS + seq });

const fixtures: Record<string, Record<string, unknown>> = {
  auction_created: { ...at(1), type: 'auction_created', config, auctioneerSub: 'host' },
  bidder_registered: {
    ...at(2),
    type: 'bidder_registered',
    bidderId: B,
    paddle: 7,
    name: 'Ana',
    ceiling: 50000,
    holdRef: 'h1',
  },
  bid_accepted: {
    ...at(3),
    type: 'bid_accepted',
    bidId: BID,
    bidderId: B,
    mid: MID,
    amount: 12000,
    source: 'qr',
    audit,
    endTsAfter: TS + 600000,
  },
  bid_rejected: {
    ...at(4),
    type: 'bid_rejected',
    bidderId: B,
    mid: MID,
    reason: 'below_increment',
    audit: { ...audit, outcome: 'rejected' },
  },
  confirm_requested: {
    ...at(5),
    type: 'confirm_requested',
    confirmId: 'c1',
    bidderId: B,
    mid: MID,
    amount: 13000,
    expiresAt: TS + 10000,
    audit,
  },
  confirm_resolved: {
    ...at(6),
    type: 'confirm_resolved',
    confirmId: 'c1',
    outcome: 'accepted',
    audit,
  },
  control: {
    ...at(7),
    type: 'control',
    controlId: 'k1',
    action: 'extend',
    by: 'host',
    args: { ms: 30000 },
    audit,
  },
  state_changed: { ...at(8), type: 'state_changed', from: 'OPEN', to: 'CLOSING', endTs: TS },
  hammered: {
    ...at(9),
    type: 'hammered',
    winnerId: B,
    price: 12000,
    ranking: [{ bidderId: B, amount: 12000 }],
  },
  ceiling_revoked: { ...at(12), type: 'ceiling_revoked', bidderId: B, reason: 'voided' },
  settle_requested: { ...at(10), type: 'settle_requested' },
  settlement_update: {
    ...at(11),
    type: 'settlement_update',
    rev: 1,
    auctionState: 'CAPTURING',
    perBidder: { [B]: 'CAPTURING' },
    amountCaptured: 12000,
    note: 'ok',
  },
};

describe('RoomEvent (T-RT-019)', () => {
  for (const [type, fixture] of Object.entries(fixtures)) {
    it(`parses ${type}`, () => {
      const res = RoomEventSchema.safeParse(fixture);
      expect(res.success).toBe(true);
      expect(res.success && res.data.type).toBe(type);
    });
  }

  it('rejects unknown types, extra fields and bad seq', () => {
    expect(RoomEventSchema.safeParse({ ...at(1), type: 'nope' }).success).toBe(false);
    expect(RoomEventSchema.safeParse({ ...fixtures.state_changed, extra: 1 }).success).toBe(false);
    expect(RoomEventSchema.safeParse({ ...fixtures.state_changed, seq: 0 }).success).toBe(false);
  });

  it('assertGapless accepts 1..n and empty', () => {
    expect(() => assertGapless([])).not.toThrow();
    expect(() => assertGapless([{ seq: 1 }, { seq: 2 }, { seq: 3 }])).not.toThrow();
    expect(() => assertGapless([{ seq: 5 }, { seq: 6 }], 5)).not.toThrow();
  });

  it('assertGapless detects gaps, repeats and a wrong start', () => {
    expect(() => assertGapless([{ seq: 1 }, { seq: 3 }])).toThrow(GavelError);
    expect(() => assertGapless([{ seq: 1 }, { seq: 1 }])).toThrow(/seq gap/);
    expect(() => assertGapless([{ seq: 2 }])).toThrow(GavelError);
  });
});
