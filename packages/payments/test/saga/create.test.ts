import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEASE_TTL_MS,
  LeaseLost,
  SettlementError,
  createSettlement,
  renewLease,
  validatePlan,
  withLease,
} from '../../src/saga/create.js';
import { MemoryJournalStore, VersionConflict } from '../../src/stores/memory.js';
import type { SettlementPlan } from '../../src/types.js';
import { FRESH_HOLDS, recordingAudit, freshJournal } from '../helpers/age.js';

function plan(over: Partial<SettlementPlan> = {}): SettlementPlan {
  return {
    auctionId: 'a1',
    reserveCents: 5000,
    candidates: [
      { bidderId: 'b1', priceCents: 22000 },
      { bidderId: 'b2', priceCents: 21000 },
    ],
    holds: {
      b1: { holdId: 'h1', authId: 'AUTH-1', ceilingCents: 30000, createdAtMs: 1 },
      b2: { holdId: 'h2', authId: 'AUTH-2', ceilingCents: 25000, createdAtMs: 2 },
      b3: { holdId: 'h3', authId: 'AUTH-3', ceilingCents: 25000, createdAtMs: 3 },
    },
    ...over,
  };
}

async function code(p: Promise<unknown> | (() => unknown)): Promise<string | undefined> {
  try {
    if (typeof p === 'function') p();
    else await p;
  } catch (e) {
    if (e instanceof SettlementError) return e.code;
    throw e;
  }
  return undefined;
}

describe('createSettlement', () => {
  it('stores a HELD journal at version 0 with every hold', async () => {
    const journals = new MemoryJournalStore();
    const r = await createSettlement({ journals, ...FRESH_HOLDS }, plan());
    expect(r.created).toBe(true);
    expect(r.journal).toEqual(await journals.load('a1'));
    expect(r.journal).toMatchObject({
      v: 1,
      version: 0,
      state: 'HELD',
      cursor: 0,
      winner: null,
      history: [],
    });
    expect(Object.keys(r.journal.holds)).toEqual(['b1', 'b2', 'b3']);
    expect(r.journal.holds['b1']).toEqual({
      holdId: 'h1',
      authId: 'AUTH-1',
      ceilingCents: 30000,
      createdAtMs: 1,
      stale: false,
    });
    expect(r.journal.plan.candidates).toHaveLength(2);
  });

  it('is idempotent for an equal plan', async () => {
    const journals = new MemoryJournalStore();
    const first = await createSettlement({ journals, ...FRESH_HOLDS }, plan());
    const second = await createSettlement({ journals, ...FRESH_HOLDS }, plan());
    expect(second.created).toBe(false);
    expect(second.journal).toEqual(first.journal);
  });

  it('returns the advanced journal, not the original, on a repeat call', async () => {
    const journals = new MemoryJournalStore();
    const { journal } = await createSettlement({ journals, ...FRESH_HOLDS }, plan());
    await journals.save({ ...journal, version: 1, state: 'BIDDING' }, 0);
    const again = await createSettlement({ journals, ...FRESH_HOLDS }, plan());
    expect(again.created).toBe(false);
    expect(again.journal.state).toBe('BIDDING');
  });

  it('T-PAY-032 a different plan is plan_mismatch and changes nothing', async () => {
    const journals = new MemoryJournalStore();
    const first = await createSettlement({ journals, ...FRESH_HOLDS }, plan());
    const other = plan({
      candidates: [
        { bidderId: 'b2', priceCents: 22000 },
        { bidderId: 'b1', priceCents: 21000 },
      ],
    });
    expect(await code(createSettlement({ journals, ...FRESH_HOLDS }, other))).toBe('plan_mismatch');
    expect(
      await code(createSettlement({ journals, ...FRESH_HOLDS }, plan({ reserveCents: 6000 }))),
    ).toBe('plan_mismatch');
    const moved = plan();
    moved.holds['b1'] = { holdId: 'h1', authId: 'AUTH-9', ceilingCents: 30000, createdAtMs: 1 };
    expect(await code(createSettlement({ journals, ...FRESH_HOLDS }, moved))).toBe('plan_mismatch');
    expect(await journals.load('a1')).toEqual(first.journal);
  });

  it('concurrent creates with the same plan produce one journal', async () => {
    const journals = new MemoryJournalStore();
    const results = await Promise.all([
      createSettlement({ journals, ...FRESH_HOLDS }, plan()),
      createSettlement({ journals, ...FRESH_HOLDS }, plan()),
      createSettlement({ journals, ...FRESH_HOLDS }, plan()),
    ]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it('concurrent creates with different plans: one wins, the other is plan_mismatch', async () => {
    const journals = new MemoryJournalStore();
    const other = plan({ reserveCents: 1 });
    const outcomes = await Promise.all([
      code(createSettlement({ journals, ...FRESH_HOLDS }, plan())),
      code(createSettlement({ journals, ...FRESH_HOLDS }, other)),
    ]);
    expect(outcomes.filter((c) => c === 'plan_mismatch')).toHaveLength(1);
  });

  it('allows a plan with no candidates (no sale)', async () => {
    const journals = new MemoryJournalStore();
    const r = await createSettlement({ journals, ...FRESH_HOLDS }, plan({ candidates: [] }));
    expect(r.journal.plan.candidates).toEqual([]);
  });

  it('does not share objects with the caller', () => {
    const p = plan();
    const j = freshJournal(p);
    p.candidates[0] = { bidderId: 'zz', priceCents: 1 };
    expect(j.plan.candidates[0]?.bidderId).toBe('b1');
  });
});

describe('plan validation', () => {
  it('the same bidder twice is plan_invalid and nothing is stored', async () => {
    const journals = new MemoryJournalStore();
    const p = plan({
      candidates: [
        { bidderId: 'b1', priceCents: 22000 },
        { bidderId: 'b1', priceCents: 21000 },
      ],
    });
    expect(await code(createSettlement({ journals, ...FRESH_HOLDS }, p))).toBe('plan_invalid');
    expect(await journals.load('a1')).toBeNull();
  });

  it('rejects the other malformed plans', () => {
    const cases: SettlementPlan[] = [
      plan({ auctionId: '' }),
      plan({ reserveCents: -1 }),
      plan({ reserveCents: 1.5 }),
      plan({ candidates: [{ bidderId: 'b1', priceCents: 0 }] }),
      plan({ candidates: [{ bidderId: 'b1', priceCents: 10.5 }] }),
      plan({ candidates: [{ bidderId: 'ghost', priceCents: 100 }] }),
      plan({ candidates: [{ bidderId: '', priceCents: 100 }] }),
      plan({ holds: { b1: { holdId: '', authId: 'A', ceilingCents: 1, createdAtMs: 0 } } }),
      plan({ holds: { b1: { holdId: 'h', authId: '', ceilingCents: 1, createdAtMs: 0 } } }),
      plan({ holds: { b1: { holdId: 'h', authId: 'A', ceilingCents: 0, createdAtMs: 0 } } }),
    ];
    for (const [i, p] of cases.entries()) {
      expect(
        (() => {
          try {
            validatePlan(p);
          } catch (e) {
            return e instanceof SettlementError ? e.code : 'other';
          }
          return 'valid';
        })(),
        `case ${i}`,
      ).toBe('plan_invalid');
    }
  });

  it('two bidders sharing one hold id is plan_invalid', () => {
    const p = plan();
    p.holds['b2'] = { holdId: 'h1', authId: 'AUTH-2', ceilingCents: 1, createdAtMs: 0 };
    expect(() => validatePlan(p)).toThrow(SettlementError);
  });

  it('a candidate priced above its hold ceiling, below the reserve, or above an earlier one is plan_invalid', () => {
    const invalid = [
      plan({ candidates: [{ bidderId: 'b1', priceCents: 30001 }] }),
      plan({ candidates: [{ bidderId: 'b1', priceCents: 4999 }] }),
      plan({
        candidates: [
          { bidderId: 'b1', priceCents: 21000 },
          { bidderId: 'b2', priceCents: 22000 },
        ],
      }),
    ];
    for (const p of invalid) {
      expect(() => validatePlan(p)).toThrow(SettlementError);
    }
    expect(() =>
      validatePlan(plan({ candidates: [{ bidderId: 'b1', priceCents: 30000 }] })),
    ).not.toThrow();
  });

  it('flags a hold older than the maximum age when the settlement is created', async () => {
    const journals = new MemoryJournalStore();
    const { sink, rows } = recordingAudit();
    const r = await createSettlement(
      { journals, clock: { nowMs: () => 10_000 }, holdMaxAgeMs: 9_998, audit: sink },
      plan(),
    );
    expect(r.journal.holds['b1']?.stale).toBe(true); // created at 1, age 9999 > 9998
    expect(r.journal.holds['b2']?.stale).toBe(false); // created at 2, age 9998
    // One stale_hold row for the flagged hold only, and none when the settlement already exists.
    expect(rows.map((x) => [x.kind, x.holdId])).toEqual([
      ['stale_hold', r.journal.holds['b1']?.holdId],
    ]);
    await createSettlement(
      { journals, clock: { nowMs: () => 10_000 }, holdMaxAgeMs: 9_998, audit: sink },
      plan(),
    );
    expect(rows).toHaveLength(1);
  });

  it('writes the stale_hold rows before the journal so a crash in between loses none', async () => {
    const journals = new MemoryJournalStore();
    const { rows } = recordingAudit();
    const order: string[] = [];
    const audit = {
      append: (e: (typeof rows)[number]) => {
        order.push('audit');
        rows.push(e);
        return Promise.resolve();
      },
    };
    const crashing = {
      ...journals,
      load: journals.load.bind(journals),
      create: () => {
        order.push('create');
        return Promise.reject(new Error('crash'));
      },
    };
    const deps = { clock: { nowMs: () => 10_000 }, holdMaxAgeMs: 9_998, audit };
    await expect(
      createSettlement({ journals: crashing as unknown as typeof journals, ...deps }, plan()),
    ).rejects.toThrow('crash');
    expect(order).toEqual(['audit', 'create']);
    expect(rows).toHaveLength(1);
    // The retry finds no journal, so it audits again and creates it.
    const r = await createSettlement({ journals, ...deps }, plan());
    expect(r.created).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it('refuses a settlement without a usable hold age limit or a hold created at NaN', async () => {
    const journals = new MemoryJournalStore();
    expect(
      await code(createSettlement({ journals, ...FRESH_HOLDS, holdMaxAgeMs: 0 }, plan())),
    ).toBe('plan_invalid');
    const p = plan();
    const first = Object.values(p.holds)[0];
    if (first === undefined) throw new Error('plan has no hold');
    first.createdAtMs = Number.NaN;
    expect(await code(createSettlement({ journals, ...FRESH_HOLDS }, p))).toBe('plan_invalid');
  });
});

describe('lease', () => {
  const rig = (): {
    journals: MemoryJournalStore;
    clock: { t: number };
    deps: { journals: MemoryJournalStore; clock: { nowMs(): number } };
  } => {
    const journals = new MemoryJournalStore();
    const clock = { t: 1_000 };
    return { journals, clock, deps: { journals, clock: { nowMs: () => clock.t } } };
  };

  it('T-PAY-032 a second concurrent run is busy and the work runs once', async () => {
    const { deps } = rig();
    let runs = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const first = withLease(deps, 'a1', 'runner-1', async () => {
      runs += 1;
      await gate;
      return 'one';
    });
    await Promise.resolve();
    const second = await withLease(deps, 'a1', 'runner-2', async () => {
      runs += 1;
      return 'two';
    });
    expect(second).toEqual({ status: 'busy' });
    release();
    expect(await first).toEqual({ status: 'done', value: 'one' });
    expect(runs).toBe(1);
  });

  it('releases the lease afterwards, also when the work throws', async () => {
    const { deps } = rig();
    await expect(
      withLease(deps, 'a1', 'runner-1', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await withLease(deps, 'a1', 'runner-2', async () => 'ok')).toEqual({
      status: 'done',
      value: 'ok',
    });
  });

  it('another owner is busy until the lease expires', async () => {
    const { deps, clock } = rig();
    expect(await deps.journals.acquireLease('a1', 'r1', 30_000, clock.t)).toBe(true);
    expect(await withLease(deps, 'a1', 'r2', async () => 1)).toEqual({ status: 'busy' });
    clock.t += 29_999;
    expect(await withLease(deps, 'a1', 'r2', async () => 1)).toEqual({ status: 'busy' });
    clock.t += 1;
    expect(await withLease(deps, 'a1', 'r2', async () => 1)).toEqual({ status: 'done', value: 1 });
  });

  it('renew extends the expiry per step', async () => {
    const { deps, clock } = rig();
    await withLease(deps, 'a1', 'r1', async (renew) => {
      clock.t += 20_000;
      await renew();
      clock.t += 20_000; // 40 s since acquire, 20 s since renew
      expect(await deps.journals.acquireLease('a1', 'r2', 30_000, clock.t)).toBe(false);
    });
  });

  it('T-PAY-053 lease expiry during a slow step: second runner takes over, first save conflicts', async () => {
    const { deps, journals, clock } = rig();
    const { journal } = await createSettlement({ journals, ...FRESH_HOLDS }, plan());

    const first = await withLease(deps, 'a1', 'runner-1', async () => {
      const mine = (await journals.load('a1')) ?? journal;
      clock.t += DEFAULT_LEASE_TTL_MS + 1; // the slow step outlives the lease

      const second = await withLease(deps, 'a1', 'runner-2', async () => {
        const theirs = (await journals.load('a1')) ?? journal;
        await journals.save(
          { ...theirs, version: theirs.version + 1, state: 'BIDDING' },
          theirs.version,
        );
        return 'took over';
      });
      expect(second).toEqual({ status: 'done', value: 'took over' });

      // runner-1 wakes up and tries to persist its step
      await expect(
        journals.save({ ...mine, version: mine.version + 1, state: 'CAPTURING' }, mine.version),
      ).rejects.toBeInstanceOf(VersionConflict);
    });
    expect(first.status).toBe('done');
    expect((await journals.load('a1'))?.state).toBe('BIDDING');
  });

  it('renew throws LeaseLost when another runner holds the lease', async () => {
    const { deps, clock } = rig();
    await deps.journals.acquireLease('a1', 'r1', 30_000, clock.t);
    clock.t += 31_000;
    await deps.journals.acquireLease('a1', 'r2', 30_000, clock.t);
    await expect(renewLease(deps, 'a1', 'r1')).rejects.toBeInstanceOf(LeaseLost);
  });
});
