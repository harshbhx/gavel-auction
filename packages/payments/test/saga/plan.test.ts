import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../../../engine/src/events.js';
import type { Ulid } from '../../../engine/src/types.js';
import { createSettlement, validatePlan } from '../../src/saga/create.js';
import { planFromOutcome, planWithSkipped } from '../../src/saga/plan.js';
import { MemoryJournalStore } from '../../src/stores/memory.js';
import type { HoldRef } from '../../src/types.js';

const hold = (id: string, ceilingCents = 20000): HoldRef => ({
  holdId: id,
  authId: `auth-${id}`,
  ceilingCents,
  createdAtMs: 1,
});
const holds = { b1: hold('h1', 15000), b2: hold('h2', 12000), b3: hold('h3') };

const u = (id: string): Ulid => id as Ulid;

type Hammered = Extract<LedgerEvent, { type: 'LOT_HAMMERED' }>['payload'];

/** A proxy outcome: A max 150.00, B max 120.00, C max 50.00, reserve 10.00. */
function proxyPayload(): Hammered {
  return {
    lotId: u('lot1'),
    winnerId: u('b1'),
    priceCents: 12100,
    mode: 'proxy',
    ranking: [
      { bidderId: u('b1'), amountCents: 15000, at: 1, seq: 1 },
      { bidderId: u('b2'), amountCents: 12000, at: 2, seq: 2 },
      { bidderId: u('b3'), amountCents: 5000, at: 3, seq: 3 },
    ],
    candidates: [
      { bidderId: u('b1'), priceCents: 12100 },
      { bidderId: u('b2'), priceCents: 5100 },
      { bidderId: u('b3'), priceCents: 1000 },
    ],
    endsAt: 10,
    extensions: 0,
    closedAtSeq: 3,
  };
}

describe('planFromOutcome', () => {
  it('takes the engine LOT_HAMMERED payload as it is and prices the runner-up at the fallback price', () => {
    const plan = planFromOutcome(proxyPayload(), holds, 1000);
    expect(plan.auctionId).toBe('lot1');
    expect(plan.reserveCents).toBe(1000);
    // b2's ranked amount is 12000, its fallback price is 5100: it is never charged its maximum.
    expect(plan.candidates).toEqual([
      { bidderId: 'b1', priceCents: 12100 },
      { bidderId: 'b2', priceCents: 5100 },
      { bidderId: 'b3', priceCents: 1000 },
    ]);
    expect(plan.holds).toEqual(holds);
    expect(() => validatePlan(plan)).not.toThrow();
  });

  it('second_price: the runner-up pays max(reserve, third), not its sealed bid', () => {
    const payload: Hammered = {
      ...proxyPayload(),
      mode: 'second_price',
      priceCents: 12000,
      candidates: [
        { bidderId: u('b1'), priceCents: 12000 },
        { bidderId: u('b2'), priceCents: 5000 },
      ],
    };
    const plan = planFromOutcome(payload, holds, 1000);
    expect(plan.candidates.map((c) => c.priceCents)).toEqual([12000, 5000]);
  });

  it('creates a settlement from real engine output', async () => {
    const journals = new MemoryJournalStore();
    const plan = planFromOutcome(proxyPayload(), holds, 1000);
    const { journal } = await createSettlement({ journals }, plan);
    expect(journal.auctionId).toBe('lot1');
    expect(journal.plan.candidates[1]).toEqual({ bidderId: 'b2', priceCents: 5100 });
  });

  it('returns no candidates when the engine produced none', () => {
    const plan = planFromOutcome(
      { lotId: 'lot1', winnerId: 'b1', priceCents: 0, candidates: [] },
      holds,
      0,
    );
    expect(plan.candidates).toEqual([]);
  });

  it('drops a candidate without a hold so the next one is the fallback', () => {
    const plan = planFromOutcome(proxyPayload(), { b2: holds.b2, b3: holds.b3 }, 1000);
    expect(plan.candidates.map((c) => c.bidderId)).toEqual(['b2', 'b3']);
    const noMiddle = planFromOutcome(proxyPayload(), { b1: holds.b1, b3: holds.b3 }, 1000);
    expect(noMiddle.candidates.map((c) => c.bidderId)).toEqual(['b1', 'b3']);
    expect(() => validatePlan(noMiddle)).not.toThrow();
  });

  it('drops a candidate priced above its hold ceiling', () => {
    const plan = planFromOutcome(proxyPayload(), { ...holds, b1: hold('h1', 12099) }, 1000);
    expect(plan.candidates.map((c) => c.bidderId)).toEqual(['b2', 'b3']);
  });

  it('rejects an outcome whose first candidate is not the winner at the hammer price', () => {
    const p = proxyPayload();
    expect(() => planFromOutcome({ ...p, winnerId: 'b2' }, holds, 0)).toThrow(/winner/);
    expect(() => planFromOutcome({ ...p, priceCents: 1 }, holds, 0)).toThrow(/winner/);
  });

  it('rejects a duplicate bidder', () => {
    const p = proxyPayload();
    expect(() =>
      planFromOutcome(
        { ...p, candidates: [...p.candidates, { bidderId: 'b2', priceCents: 1000 }] },
        holds,
        0,
      ),
    ).toThrow(/duplicate bidder/);
  });

  it('reports who was skipped so the engine can be told', () => {
    const r = planWithSkipped(proxyPayload(), { b2: holds.b2, b3: hold('h3', 500) }, 1000);
    expect(r.plan.candidates.map((c) => c.bidderId)).toEqual(['b2']);
    expect(r.skipped).toEqual([
      { bidderId: 'b1', priceCents: 12100, reason: 'no_hold' },
      { bidderId: 'b3', priceCents: 1000, reason: 'price_above_hold' },
    ]);
  });

  it('reports no skips when every candidate can be charged', () => {
    expect(planWithSkipped(proxyPayload(), holds, 1000).skipped).toEqual([]);
  });
});
