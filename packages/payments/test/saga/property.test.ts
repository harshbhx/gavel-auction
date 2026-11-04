import { describe, expect, it } from 'vitest';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import {
  AUCTION_ID,
  drive,
  enumerate,
  prng,
  randomCase,
  type RandomCase,
} from '../helpers/crashHarness.js';

/**
 * Randomized faults and crashes (R-PAY-061, T-PAY-052). Each seed fixes a plan of 2
 * to 8 bidders, one fault from the taxonomy of SPEC 4.5 and one to two crash
 * points. Whatever happens, the invariants hold, at most one capture is made, and
 * the settlement is terminal within ten resumes or stays pending with no capture to
 * anyone but its winner. A failure names the seed and the case.
 */

const SEEDS = 500;
const MAX_RESUMES = 10;

async function check(c: RandomCase): Promise<void> {
  const labels = await enumerate(c.scenario);
  const rand = prng(c.seed ^ 0x9e3779b9);
  const crashes = 1 + Math.floor(rand() * 2);
  const crashAt = Array.from({ length: crashes }, () => Math.floor(rand() * (labels.length + 3)));

  const r = await drive(c.scenario, {
    crashAt,
    forgetIdempotency: c.fault.kind === 'forget_idempotency',
    maxRuns: MAX_RESUMES + 1 + crashAt.length,
  });
  assertFakeInvariants(r.rig.core);

  const captured = Object.entries(r.rig.auth).filter(
    ([, authId]) => r.rig.core.inspect(authId).capturedCents > 0,
  );
  expect(captured.length, 'at most one capture').toBeLessThanOrEqual(1);
  const winner = r.journal.winner;
  if (winner !== null) {
    expect(captured.map(([b]) => b)).toEqual([winner.bidderId]);
  }

  const terminal = r.journal.state === 'SETTLED' || r.journal.state === 'FAILED_NEEDS_REVIEW';
  if (!terminal) {
    // Pending: nothing may have been captured for anyone but the candidate in doubt.
    const cursor = r.journal.plan.candidates[r.journal.cursor]?.bidderId;
    for (const [bidder] of captured) expect([winner?.bidderId, cursor]).toContain(bidder);
  }
  expect(r.journal.auctionId).toBe(AUCTION_ID);
}

function describeCase(c: RandomCase): string {
  const f = c.fault;
  return `seed=${c.seed} bidders=${Object.keys(c.scenario.ceilings).length} candidates=${JSON.stringify(
    c.scenario.candidates,
  )} fault=${f.op}:${f.kind}@${f.target ?? 'any'}`;
}

describe('T-PAY-052 randomized plans, faults and crashes', () => {
  it(`holds the invariants for ${SEEDS} seeds`, async () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const c = randomCase(seed);
      try {
        await check(c);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`property failed: ${describeCase(c)}\n${msg}`, { cause: e });
      }
    }
  }, 120_000);

  it('the cases cover 2 to 8 bidders and every fault op', () => {
    const sizes = new Set<number>();
    const ops = new Set<string>();
    const kinds = new Set<string>();
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const c = randomCase(seed);
      sizes.add(Object.keys(c.scenario.ceilings).length);
      ops.add(c.fault.op);
      kinds.add(c.fault.kind);
    }
    expect([...sizes].sort()).toEqual(['2', '3', '4', '5', '6', '7', '8'].map(Number));
    expect([...ops].sort()).toEqual(['capture', 'get', 'void']);
    expect(kinds.size).toBeGreaterThanOrEqual(7);
  });
});
