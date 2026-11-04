import { describe, expect, it } from 'vitest';
import type { Clock, PaymentsGateway, PaymentsMetrics } from '../../src/ports.js';
import { createMetrics } from '../../src/metrics.js';
import {
  FINDING_CODES,
  reconcile,
  type FindingCode,
  type ReconcileReport,
} from '../../src/reconcile/reconcile.js';
import { MemoryHoldStore, MemoryJournalStore } from '../../src/stores/memory.js';
import type { HoldRecord, HoldStatus, HoldTruth, Journal } from '../../src/types.js';

const AUCTION = 'A1';
const T0 = 1_800_000_000_000;

function journal(over: Partial<Journal> = {}): Journal {
  return {
    v: 1,
    auctionId: AUCTION,
    version: 3,
    state: 'SETTLED',
    plan: {
      reserveCents: 5000,
      candidates: [
        { bidderId: 'b1', priceCents: 22000 },
        { bidderId: 'b2', priceCents: 21000 },
      ],
    },
    holds: {
      b1: { holdId: 'h1', authId: 'AUTH-1', ceilingCents: 30000, stale: false },
      b2: { holdId: 'h2', authId: 'AUTH-2', ceilingCents: 25000, stale: false },
    },
    cursor: 0,
    intent: null,
    unknownSince: null,
    winner: { bidderId: 'b1', holdId: 'h1', captureId: 'C1', amountCents: 22000 },
    failed: [],
    voids: { b2: 'VOIDED' },
    resumes: 0,
    history: [],
    ...over,
  };
}

function record(holdId: string, bidderId: string, status: HoldStatus): HoldRecord {
  return {
    holdId,
    auctionId: AUCTION,
    bidderId,
    orderId: `O-${holdId}`,
    authId: holdId === 'h1' ? 'AUTH-1' : 'AUTH-2',
    ceilingCents: holdId === 'h1' ? 30000 : 25000,
    status,
    createdAtMs: T0,
  };
}

function truth(holdId: string, over: Partial<HoldTruth> = {}): HoldTruth {
  const won = holdId === 'h1';
  return {
    holdId,
    authId: won ? 'AUTH-1' : 'AUTH-2',
    status: won ? 'CAPTURED' : 'VOIDED',
    amountCents: won ? 30000 : 25000,
    capturedCents: won ? 22000 : 0,
    captures: won ? [{ captureId: 'C1', amountCents: 22000, final: true }] : [],
    observedAtMs: T0,
    ...over,
  };
}

interface Fixture {
  journal?: Journal | null;
  records?: HoldRecord[];
  truths?: Record<string, HoldTruth | 'throw'>;
}

class Ticking implements Clock {
  constructor(private now = T0) {}
  nowMs(): number {
    return this.now++;
  }
}

async function run(
  f: Fixture,
  metrics?: PaymentsMetrics,
  clock: Clock = new Ticking(),
): Promise<ReconcileReport> {
  const journals = new MemoryJournalStore();
  const j = f.journal === undefined ? journal() : f.journal;
  if (j !== null) await journals.create(j);
  const holds = new MemoryHoldStore();
  const records = f.records ?? [record('h1', 'b1', 'CAPTURED'), record('h2', 'b2', 'VOIDED')];
  for (const r of records) await holds.put(r);
  const truths: Record<string, HoldTruth | 'throw'> = {
    h1: truth('h1'),
    h2: truth('h2'),
    ...f.truths,
  };
  const gateway = {
    async getHoldTruth(h: { holdId: string }): Promise<HoldTruth> {
      const t = truths[h.holdId];
      if (t === undefined || t === 'throw') throw new Error('unreachable');
      return t;
    },
  } as unknown as PaymentsGateway;
  return reconcile({ gateway, journals, holds, clock, ...(metrics ? { metrics } : {}) }, AUCTION);
}

const codes = (r: ReconcileReport): FindingCode[] => r.findings.map((x) => x.code);

describe('reconcile (R-PAY-100, R-PAY-103, T-PAY-071)', () => {
  it('reports nothing when journal, records and PayPal agree', async () => {
    const r = await run({});
    expect(r.findings).toEqual([]);
    expect(r.journalState).toBe('SETTLED');
  });

  const drift: Array<[FindingCode, Fixture, string]> = [
    [
      'MISSING_CAPTURE',
      {
        records: [record('h1', 'b1', 'UNKNOWN'), record('h2', 'b2', 'VOIDED')],
        truths: { h1: truth('h1', { status: 'NOT_FOUND', capturedCents: 0, captures: [] }) },
      },
      'h1',
    ],
    [
      'EXTRA_CAPTURE',
      {
        journal: journal({ state: 'CAPTURING', winner: null, voids: {} }),
      },
      'h1',
    ],
    [
      'REFUNDED_CAPTURE',
      {
        truths: {
          h1: truth('h1', {
            captures: [
              {
                captureId: 'C1',
                amountCents: 22000,
                final: true,
                refund: { status: 'REFUNDED', refundedCents: 22000 },
              },
            ],
          }),
        },
      },
      'h1',
    ],
    ['AMOUNT_MISMATCH', { truths: { h1: truth('h1', { capturedCents: 21000 }) } }, 'h1'],
    [
      'LIVE_HOLD_AFTER_SETTLED',
      {
        journal: journal({ voids: {} }),
        records: [record('h1', 'b1', 'CAPTURED'), record('h2', 'b2', 'HELD')],
        truths: { h2: truth('h2', { status: 'CREATED' }) },
      },
      'h2',
    ],
    [
      'STATUS_DRIFT',
      { records: [record('h1', 'b1', 'CAPTURED'), record('h2', 'b2', 'HELD')] },
      'h2',
    ],
    [
      'STATUS_CONFLICT',
      {
        records: [record('h1', 'b1', 'CAPTURED'), record('h2', 'b2', 'VOIDED')],
        truths: { h2: truth('h2', { status: 'CAPTURED', capturedCents: 100 }) },
      },
      'h2',
    ],
    ['UNOBSERVABLE', { truths: { h1: truth('h1', { captures: null }) } }, 'h1'],
  ];

  it.each(drift)('%s is reported once for the hold that drifted', async (code, fixture, holdId) => {
    const r = await run(fixture);
    expect(codes(r).filter((c) => c === code)).toHaveLength(1);
    expect(r.findings.find((f) => f.code === code)?.holdId).toBe(holdId);
    expect(r.findings.every((f) => f.code === code)).toBe(true);
  });

  it('reads a journal void recorded under the hold id as a conflict with a PayPal capture', async () => {
    const r = await run({
      journal: journal({ voids: { h2: 'voided' } }),
      records: [record('h1', 'b1', 'CAPTURED'), record('h2', 'b2', 'CAPTURED')],
      truths: { h2: truth('h2', { status: 'CAPTURED', capturedCents: 100 }) },
    });
    expect(codes(r)).toContain('STATUS_CONFLICT');
  });

  it('covers every finding code in the fixtures', () => {
    expect(new Set(drift.map(([c]) => c))).toEqual(new Set(FINDING_CODES));
  });

  it('reports a failed truth read as UNOBSERVABLE and still checks the other holds', async () => {
    const r = await run({
      truths: { h1: 'throw', h2: truth('h2', { status: 'CREATED' }) },
      journal: journal({ voids: {} }),
      records: [record('h1', 'b1', 'CAPTURED'), record('h2', 'b2', 'HELD')],
    });
    expect(codes(r)).toEqual(['LIVE_HOLD_AFTER_SETTLED', 'UNOBSERVABLE']);
  });

  it('two runs on unchanged state are equal besides observedAt', async () => {
    const f: Fixture = {
      journal: journal({ voids: {} }),
      records: [record('h1', 'b1', 'HELD'), record('h2', 'b2', 'HELD')],
      truths: {
        h1: truth('h1', { capturedCents: 20000 }),
        h2: truth('h2', { status: 'CREATED' }),
      },
    };
    const clock = new Ticking();
    const a = await run(f, undefined, clock);
    const b = await run(f, undefined, clock);
    expect(b.observedAt).toBeGreaterThan(a.observedAt);
    expect({ ...a, observedAt: 0 }).toEqual({ ...b, observedAt: 0 });
    expect(a.findings.length).toBeGreaterThan(1);
  });

  it('orders findings by code, then bidder id', async () => {
    const r = await run({
      journal: journal({ voids: {} }),
      records: [record('h1', 'b1', 'CAPTURED'), record('h2', 'b2', 'HELD')],
      truths: {
        h1: truth('h1', { capturedCents: 20000 }),
        h2: truth('h2', { status: 'CREATED' }),
      },
    });
    expect(r.findings.map((f) => [f.code, f.bidderId])).toEqual([
      ['AMOUNT_MISMATCH', 'b1'],
      ['LIVE_HOLD_AFTER_SETTLED', 'b2'],
    ]);
  });

  it('does not call an in-flight capture an extra capture', async () => {
    const r = await run({
      journal: journal({
        state: 'CAPTURING',
        winner: null,
        voids: {},
        intent: {
          op: 'capture',
          holdId: 'h1',
          requestId: 'r',
          amountCents: 22000,
          startedAtMs: T0,
        },
      }),
      truths: { h2: truth('h2', { status: 'CREATED' }) },
      records: [record('h1', 'b1', 'CAPTURED'), record('h2', 'b2', 'HELD')],
    });
    expect(r.findings).toEqual([]);
  });

  it('checks hold records alone when no journal exists yet', async () => {
    const r = await run({ journal: null });
    expect(r.journalState).toBeNull();
    expect(codes(r)).toEqual(['EXTRA_CAPTURE']);
  });

  it('counts findings in metrics by code', async () => {
    const metrics = createMetrics();
    await run({ truths: { h1: truth('h1', { capturedCents: 21000 }) } }, metrics);
    expect(metrics.counter('reconcile_findings_total', { code: 'AMOUNT_MISMATCH' })).toBe(1);
  });

  it('does not treat an inherited property name as a voided bidder', async () => {
    const r = await run({
      journal: journal({ voids: {} }),
      records: [record('h1', 'b1', 'CAPTURED'), record('h2', 'constructor', 'HELD')],
      truths: { h2: truth('h2', { status: 'CAPTURED', capturedCents: 100 }) },
    });
    expect(codes(r)).not.toContain('STATUS_CONFLICT');
  });
});
