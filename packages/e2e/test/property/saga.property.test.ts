import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { FakeFaultKind } from '../../../payments/src/fake/core';
import { assertFakeInvariants } from '../../../payments/src/fake/invariants';
import type { PaymentsGateway } from '../../../payments/src/ports';
import { runSettlement } from '../../../payments/src/saga/void';
import type { SettlementOutcome } from '../../../payments/src/saga/void';
import { CEILINGS, makeRig, seed } from '../../../payments/test/saga/rig';
import { loadRegressions, propertyParams } from '../../src/property/harness';

// T-QA-024: random fault schedules (at most six faults and one random kill checkpoint) must
// always end with the saga invariants I1..I5:
//   I1 the fake PayPal rules hold (captures within the cap, one final capture, one void effect)
//   I2 at most one bidder was captured
//   I3 the journal winner, when there is one, is the captured bidder
//   I4 the settlement is terminal, or still pending with no capture beyond the winner or the
//      candidate in doubt
//   I5 no authorization receives more void calls than its faults and the kill can explain
// A failing schedule is written to fixtures/regressions/saga and replayed on every run.

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '../../fixtures/regressions/saga');
const AUCTION_ID = 'auc1';
const BIDDERS = ['b1', 'b2', 'b3'] as const;
const CANDIDATES: Array<[string, number]> = [
  ['b1', 22000],
  ['b2', 21000],
  ['b3', 20000],
];
const MAX_RUNS = 40;
const CASES = 300;
const DESCRIBE_NAME = 'T-QA-024 saga invariants under random fault schedules';
const PROPERTY_NAME = `${DESCRIBE_NAME} > holds I1..I5 for ${String(CASES)} random schedules`;

type FaultOp = 'capture' | 'void' | 'get';

const FAULTS: Record<FaultOp, readonly FakeFaultKind[]> = {
  capture: [
    'timeout_before',
    'timeout_after_success',
    'http_500',
    'http_429',
    'connection_reset',
    'forget_idempotency',
    'capture_declined',
  ],
  void: [
    'timeout_before',
    'timeout_after_success',
    'http_500',
    'http_429',
    'connection_reset',
    'forget_idempotency',
  ],
  get: ['timeout_before', 'http_500', 'http_429', 'connection_reset'],
};

interface FaultSpec {
  op: FaultOp;
  kind: FakeFaultKind;
  /** Index into BIDDERS, or null for any authorization. */
  target: number | null;
  times: number;
}

interface Schedule {
  faults: FaultSpec[];
  /** Boundary index at which the runner is killed, or null for no kill. */
  kill: number | null;
}

const faultArb: fc.Arbitrary<FaultSpec> = fc
  .constantFrom<FaultOp[]>('capture', 'void', 'get')
  .chain((op) =>
    fc.record({
      op: fc.constant(op),
      kind: fc.constantFrom(...FAULTS[op]),
      target: fc.option(fc.integer({ min: 0, max: BIDDERS.length - 1 }), { nil: null }),
      times: fc.integer({ min: 1, max: 2 }),
    }),
  );

const scheduleArb: fc.Arbitrary<Schedule> = fc.record({
  faults: fc.array(faultArb, { minLength: 0, maxLength: 6 }),
  kill: fc.option(fc.integer({ min: 0, max: 60 }), { nil: null }),
});

class Kill extends Error {
  constructor(readonly index: number) {
    super(`killed at boundary ${String(index)}`);
    this.name = 'Kill';
  }
}

type Wrap = (gateway: PaymentsGateway) => PaymentsGateway;

async function runSchedule(s: Schedule, wrap?: Wrap): Promise<void> {
  const rig = makeRig(CEILINGS);
  await seed(rig, CANDIDATES, CEILINGS);
  for (const f of s.faults) {
    const bidder = f.target === null ? undefined : BIDDERS[f.target];
    const authId = bidder === undefined ? null : (rig.auth[bidder] ?? null);
    rig.core.inject(f.op, f.kind, authId, f.times);
  }

  let n = 0;
  const boundary = (): void => {
    const index = n;
    n += 1;
    if (s.kill === index) throw new Kill(index);
  };
  const deps = { ...rig.deps, gateway: wrap === undefined ? rig.gw : wrap(rig.gw), boundary };

  let outcome: SettlementOutcome | null = null;
  for (let run = 0; run < MAX_RUNS; run += 1) {
    try {
      outcome = await runSettlement(deps, AUCTION_ID);
      if (outcome.status === 'settled' || outcome.status === 'failed') break;
    } catch (e) {
      if (!(e instanceof Kill)) throw e;
    }
  }

  // I1
  assertFakeInvariants(rig.core);

  const journal = await rig.journals.load(AUCTION_ID);
  if (journal === null) throw new Error('settlement missing');

  // I2
  const captured = Object.entries(rig.auth).filter(
    ([, authId]) => rig.core.inspect(authId).capturedCents > 0,
  );
  expect(captured.length, 'I2 at most one capture').toBeLessThanOrEqual(1);

  // I3
  const winner = journal.winner;
  if (winner !== null) {
    expect(
      captured.map(([b]) => b),
      'I3 the winner is the captured bidder',
    ).toEqual([winner.bidderId]);
  }

  // I4
  const terminal = journal.state === 'SETTLED' || journal.state === 'FAILED_NEEDS_REVIEW';
  if (!terminal) {
    const cursor = journal.plan.candidates[journal.cursor]?.bidderId;
    for (const [bidder] of captured) expect([winner?.bidderId, cursor]).toContain(bidder);
  }

  // I5
  const voidFaults = s.faults.filter((f) => f.op === 'void').reduce((sum, f) => sum + f.times, 0);
  const allowed = 1 + voidFaults + (s.kill === null ? 0 : 1);
  for (const [bidder, authId] of Object.entries(rig.auth)) {
    const calls = rig.core.calls.filter((c) => c.id === authId && c.op === 'void').length;
    expect(calls, `I5 void calls for ${bidder}`).toBeLessThanOrEqual(allowed);
  }
}

function property(wrap?: Wrap): fc.IAsyncPropertyWithHooks<[Schedule]> {
  return fc.asyncProperty(scheduleArb, (s) => runSchedule(s, wrap));
}

/** The shared reporter prints; this runner throws, and saves the failing schedule. */
async function assertProperty(): Promise<void> {
  const d = await fc.check(property(), propertyParams({ numRuns: CASES }));
  if (!d.failed) return;
  try {
    mkdirSync(FIXTURES, { recursive: true });
    const path = (d.counterexamplePath ?? '')
      .split(':')
      .filter((n) => n !== '')
      .map(Number);
    const entry = {
      seed: d.seed,
      path,
      property: PROPERTY_NAME,
      value: d.counterexample ?? [],
    };
    writeFileSync(resolve(FIXTURES, `saga-${String(d.seed)}.json`), JSON.stringify(entry, null, 2));
  } catch {
    // The fixture is a convenience; the failure below carries the same data.
  }
  throw new Error(
    `saga property failed, replay with GAVEL_PROPERTY_SEED=${String(d.seed)}: ${JSON.stringify(d.counterexample)}`,
  );
}

describe(DESCRIBE_NAME, () => {
  it(`holds I1..I5 for ${String(CASES)} random schedules`, async () => {
    await assertProperty();
  }, 120_000);

  it('replays every saved regression schedule', async () => {
    for (const entry of loadRegressions<Schedule>(FIXTURES)) {
      const [schedule] = entry.value;
      await runSchedule(schedule as Schedule);
    }
  }, 60_000);

  it('finds a seeded double void within 300 cases', async () => {
    const doubleVoid: Wrap = (base) => ({
      createOrder: (i) => base.createOrder(i),
      getOrder: (id) => base.getOrder(id),
      authorizeOrder: (id, r) => base.authorizeOrder(id, r),
      getHoldTruth: (h) => base.getHoldTruth(h),
      capture: (a, i) => base.capture(a, i),
      reauthorize: (a, i) => base.reauthorize(a, i),
      voidAuthorization: async (a, r) => {
        const first = await base.voidAuthorization(a, r);
        try {
          await base.voidAuthorization(a, r);
        } catch {
          // the fake refuses the second void; the extra call is the bug
        }
        return first;
      },
    });
    const d = await fc.check(property(doubleVoid), { numRuns: CASES, seed: 20241105 });
    expect(d.failed).toBe(true);
  }, 120_000);
});
