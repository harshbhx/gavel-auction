import { describe, expect, it } from 'vitest';
import { RoomSnapshotSchema } from '../src/wire/server';

const B1 = '01J9ZQ3A0B2C4D6F8H0J2K4M6N';
const AUCTION = '01J9ZQ4Y6Z8K3M5N7P9R1S3T5V';

const base = {
  auctionId: AUCTION,
  config: {
    currency: 'USD',
    reserve: 10000,
    minIncrement: 1000,
    endTs: 1789000060000,
    softCloseWindowMs: 10000,
    softCloseExtensionMs: 10000,
    maxExtensions: 3,
    ceilingPresets: [50000],
    confirmConfidenceThreshold: 0.7,
  },
  status: 'OPEN',
  price: 35000,
  leaderId: B1,
  endTs: 1789000060000,
  minNext: 36000,
  roster: [{ bidderId: B1, paddle: 12, name: 'Ada', hold: 'HELD' }],
  recentAudit: [],
};

describe('snapshot fundraiser goal (optional, backwards compatible)', () => {
  it('parses a snapshot with no fundraiser field, as older servers send it', () => {
    const parsed = RoomSnapshotSchema.parse(base);
    expect(parsed.fundraiser).toBeUndefined();
  });

  it('parses an integer-cents goal', () => {
    const parsed = RoomSnapshotSchema.parse({ ...base, fundraiser: { goalCents: 2500000 } });
    expect(parsed.fundraiser?.goalCents).toBe(2500000);
  });

  it('refuses a zero, negative, fractional or unknown-key goal', () => {
    for (const fundraiser of [
      { goalCents: 0 },
      { goalCents: -100 },
      { goalCents: 10.5 },
      { goalCents: 100, extra: 1 },
      {},
    ]) {
      expect(RoomSnapshotSchema.safeParse({ ...base, fundraiser }).success).toBe(false);
    }
  });
});
