import { remainderKey, settlementUpdateFor, type Journal } from '@gavel/payments';
import { OwnHoldSchema } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { ownHoldsOf } from '../../src/runtime/own-holds';

const A = '01J9ZQ3A0B2C4D6F8H0J2K4M6A';
const B = '01J9ZQ3A0B2C4D6F8H0J2K4M6B';
const C = '01J9ZQ3A0B2C4D6F8H0J2K4M6C';

const hold = (holdId: string, ceilingCents: number) => ({
  holdId,
  authId: `AUTH-${holdId}`,
  ceilingCents,
  stale: false,
});

function journal(over: Partial<Journal> = {}): Journal {
  return {
    v: 1,
    auctionId: '01J9ZQ4Y6Z8K3M5N7P9R1S3T5V',
    version: 4,
    state: 'VOIDING',
    plan: { reserveCents: 10000, candidates: [] },
    holds: {
      [A]: hold('HOLD-AAAAAA', 50000),
      [B]: hold('HOLD-BBBBBB', 30000),
      [C]: hold('HOLD-CCCCCC', 30000),
    },
    cursor: 0,
    intent: null,
    unknownSince: null,
    winner: { bidderId: A, holdId: 'HOLD-AAAAAA', captureId: 'CAP-1', amountCents: 13000 },
    failed: [],
    voids: {},
    resumes: 0,
    history: [],
    ...over,
  };
}

describe('own hold detail from the settlement payload (issue 712)', () => {
  it('gives the winner the capture and the remainder, the others their release', () => {
    const own = ownHoldsOf(
      journal({ voids: { [B]: 'voided', [remainderKey(A)]: 'remainder_released' } }),
      1,
    );
    expect(own.winnerId).toBe(A);
    expect(own.holds[A]).toEqual({
      idSuffix: 'AAAAAA',
      status: 'CAPTURED',
      ceilingCents: 50000,
      capturedCents: 13000,
      releasedCents: 37000,
      remainder: 'released',
    });
    expect(own.holds[B]).toEqual({
      idSuffix: 'BBBBBB',
      status: 'VOIDED',
      ceilingCents: 30000,
      capturedCents: 0,
      releasedCents: 30000,
      remainder: 'none',
    });
    // Not voided yet: the money is still held.
    expect(own.holds[C]).toMatchObject({ status: 'HELD', releasedCents: 0, remainder: 'none' });
  });

  it('agrees with the statuses the payments emitter publishes', () => {
    const j = journal({
      voids: { [B]: 'voided' },
      failed: [{ bidderId: C, reason: 'hold_expired' }],
    });
    const own = ownHoldsOf(j, 1);
    for (const h of settlementUpdateFor(j, 1).holds) {
      expect(own.holds[h.bidderId]?.status).toBe(h.status);
    }
    expect(own.holds[C]).toMatchObject({ status: 'EXPIRED', releasedCents: 30000 });
  });

  it('reports a remainder that is still open or was left to lapse', () => {
    expect(ownHoldsOf(journal(), 1).holds[A]).toMatchObject({
      remainder: 'pending',
      releasedCents: 0,
    });
    const left = ownHoldsOf(journal({ voids: { [remainderKey(A)]: 'remainder_unreleased' } }), 1);
    expect(left.holds[A]).toMatchObject({ remainder: 'unreleased', releasedCents: 0 });
  });

  it('has no remainder when the price took the whole hold, and no winner before a capture', () => {
    const whole = ownHoldsOf(
      journal({
        winner: { bidderId: B, holdId: 'HOLD-BBBBBB', captureId: 'CAP-2', amountCents: 30000 },
      }),
      1,
    );
    expect(whole.holds[B]).toMatchObject({ capturedCents: 30000, remainder: 'none' });
    const before = ownHoldsOf(journal({ winner: null, state: 'CAPTURING' }), 1);
    expect(before.winnerId).toBeUndefined();
    expect(Object.values(before.holds).every((h) => h.capturedCents === 0)).toBe(true);
  });

  it('builds entries the shared wire schema accepts once the bidder id is added', () => {
    const own = ownHoldsOf(journal({ voids: { [B]: 'voided' } }), 1);
    for (const [bidderId, h] of Object.entries(own.holds)) {
      expect(OwnHoldSchema.safeParse({ ...h, bidderId }).success).toBe(true);
    }
  });
});
