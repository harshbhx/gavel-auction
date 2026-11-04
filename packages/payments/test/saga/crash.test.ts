import { describe, expect, it } from 'vitest';
import {
  DECLINED_FIRST,
  LOST_FIRST_CAPTURE,
  THREE_BIDDERS,
  assertEquivalent,
  drive,
  enumerate,
  type Scenario,
} from '../helpers/crashHarness.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';

/**
 * Crash at every boundary, then resume (R-PAY-042, R-PAY-060). Port of the
 * prototype's test_crash_at_every_boundary_then_resume. The labels come from a
 * dry run, so a new boundary in the saga is covered without editing this file.
 */

const SCENARIOS: Array<[string, Scenario]> = [
  ['winner at the first candidate', THREE_BIDDERS],
  ['runner-up after a decline', DECLINED_FIRST],
];

describe('dry run', () => {
  it('visits the boundaries of capture and void', async () => {
    const labels = await enumerate(THREE_BIDDERS);
    expect(labels).toEqual(
      expect.arrayContaining([
        'journaled:begin',
        'before:get',
        'after:get',
        'journaled:intent',
        'before:capture',
        'after:capture',
        'journaled:capture_ok',
        'journaled:begin_void',
        'before:void',
        'after:void',
        'journaled:all_released',
      ]),
    );
    expect(labels.some((l) => l.startsWith('journaled:void_'))).toBe(true);
  });

  it('is the same on every run', async () => {
    expect(await enumerate(THREE_BIDDERS)).toEqual(await enumerate(THREE_BIDDERS));
  });

  it('an uninterrupted run settles with one capture and the other holds released', async () => {
    const r = await drive(THREE_BIDDERS);
    expect(r.journal.state).toBe('SETTLED');
    expect(r.journal.winner).toMatchObject({ bidderId: 'b1', amountCents: 22000 });
    expect(r.crashes).toBe(0);
    assertFakeInvariants(r.rig.core);
  });
});

for (const [name, scenario] of SCENARIOS) {
  const labels = await enumerate(scenario);
  const base = await drive(scenario);
  const points = labels.map((label, index): [number, string] => [index, label]);

  describe(`T-PAY-044 crash at every label: ${name} (${labels.length} labels)`, () => {
    it.each(points)('crash at %i %s, then resume', async (index) => {
      await assertEquivalent(scenario, [index], {}, base);
    });
  });

  describe(`T-PAY-045 crash everywhere plus forget_idempotency: ${name}`, () => {
    it.each(points)('crash at %i %s, forget, then resume', async (index) => {
      await assertEquivalent(scenario, [index], { forgetIdempotency: true }, base);
    });
  });
}

const lostLabels = await enumerate(LOST_FIRST_CAPTURE);
const lostBase = await drive(LOST_FIRST_CAPTURE);

describe('T-PAY-046 crash everywhere plus a lost answer on the first capture', () => {
  const labels = lostLabels;
  const base = lostBase;
  it('the uninterrupted run needs a second run and still captures once', () => {
    expect(base.runs).toBeGreaterThan(1);
    expect(base.rig.core.getAuthorization(base.rig.auth['b1'] ?? '').captures).toHaveLength(1);
    expect(base.journal.winner?.bidderId).toBe('b1');
  });
  it.each(labels.map((label, index): [number, string] => [index, label]))(
    'crash at %i %s, then resume',
    async (index) => {
      await assertEquivalent(LOST_FIRST_CAPTURE, [index], {}, base);
    },
  );
  it('and with forget_idempotency before every resume', async () => {
    for (let index = 0; index < labels.length; index += 1) {
      await assertEquivalent(LOST_FIRST_CAPTURE, [index], { forgetIdempotency: true }, base);
    }
  });
});
