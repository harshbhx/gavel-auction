import { describe, expect, it } from 'vitest';
import { PayPalError } from '../../src/errors.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { fallbackOf } from '../../src/saga/fallback.js';
import { newJournal } from '../../src/saga/create.js';
import { runSettlement } from '../../src/saga/void.js';
import { CEILINGS, callsOf, makeRig, planFor, seed, withGateway } from './rig.js';

function capturedTotal(rig: ReturnType<typeof makeRig>): number {
  return Object.values(rig.auth).reduce((sum, id) => sum + rig.core.inspect(id).capturedCents, 0);
}

describe('T-PAY-036 winner capture declined', () => {
  it('reads the truth, falls back to the runner-up at its own price and voids the loser', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const b1 = rig.auth['b1'] ?? '';
    rig.core.inject('capture', 'capture_declined', b1, 1);

    const out = await runSettlement(rig.deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    const j = out.journal;
    expect(j.failed).toEqual([{ bidderId: 'b1', reason: 'declined' }]);
    expect(j.winner).toMatchObject({ bidderId: 'b2', amountCents: 21000 });
    expect(j.history.map((h) => h.to)).toEqual([
      'BIDDING',
      'WINNER_SELECTED',
      'CAPTURING',
      'FALLBACK_RUNNER_UP',
      'CAPTURING',
      'CAPTURED',
      'VOIDING',
      'SETTLED',
    ]);
    // Before the capture, after the refusal (the truth check), then the void phase.
    expect(rig.core.calls.filter((c) => c.id === b1).map((c) => c.op)).toEqual([
      'get',
      'capture',
      'get',
      'void',
    ]);
    expect(j.voids['b1']).toBe('voided');
    expect(rig.core.inspect(b1)).toMatchObject({ capturedCents: 0, voidEffects: 1 });
    expect(capturedTotal(rig)).toBe(21000);
    assertFakeInvariants(rig.core);
  });

  it('with every candidate declining there is no sale and every hold is voided', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    for (const b of ['b1', 'b2', 'b3'])
      rig.core.inject('capture', 'capture_declined', rig.auth[b] ?? '', 1);
    const out = await runSettlement(rig.deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.winner).toBeNull();
    expect(out.journal.failed.map((f) => f.bidderId)).toEqual(['b1', 'b2', 'b3']);
    expect(capturedTotal(rig)).toBe(0);
    for (const id of Object.values(rig.auth)) expect(rig.core.inspect(id).voidEffects).toBe(1);
  });
});

describe('T-PAY-037 the winner hold is gone', () => {
  it('voided outside the system: falls back once', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.core.void(rig.auth['b1'] ?? '');
    const out = await runSettlement(rig.deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.failed).toEqual([{ bidderId: 'b1', reason: 'hold_voided' }]);
    expect(out.journal.winner?.bidderId).toBe('b2');
    // No capture was even tried on the dead hold, and it is released, not voided twice.
    expect(callsOf(rig, rig.auth['b1'] ?? '', 'capture')).toBe(0);
    expect(out.journal.voids['b1']).toBe('released');
    expect(capturedTotal(rig)).toBe(21000);
  });

  it('expired by the clock after 30 days: falls back once', async () => {
    const rig = makeRig({ b1: 30000 });
    rig.clock.advance(30 * 24 * 3600 * 1000);
    rig.auth['b2'] = rig.core.createAuthorization('payer-b2', 25000).id;
    await seed(
      rig,
      [
        ['b1', 22000],
        ['b2', 21000],
      ],
      { b1: 30000, b2: 25000 },
    );
    const out = await runSettlement(rig.deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.failed).toEqual([{ bidderId: 'b1', reason: 'hold_expired' }]);
    expect(out.journal.winner).toMatchObject({ bidderId: 'b2', amountCents: 21000 });
    expect(out.journal.voids['b1']).toBe('released');
  });
});

describe('T-PAY-038 a refusal that was applied', () => {
  it('capture answers 422 but the fake captured: adopt it, no second capture', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const deps = withGateway(rig, {
      capture: async (authId, i) => {
        await rig.gw.capture(authId, i);
        throw new PayPalError({
          kind: 'declined',
          status: 422,
          name: 'INSTRUMENT_DECLINED',
          message: 'declined',
          outcome: 'definite',
        });
      },
    });
    const out = await runSettlement(deps, 'auc1');
    expect(out.status).toBe('settled');
    if (out.status !== 'settled') return;
    expect(out.journal.failed).toEqual([]);
    expect(out.journal.winner).toMatchObject({ bidderId: 'b1', amountCents: 22000 });
    expect(out.journal.history.map((h) => h.to)).not.toContain('FALLBACK_RUNNER_UP');
    expect(callsOf(rig, rig.auth['b1'] ?? '', 'capture')).toBe(1);
    expect(callsOf(rig, rig.auth['b2'] ?? '', 'capture')).toBe(0);
    expect(capturedTotal(rig)).toBe(22000);
    assertFakeInvariants(rig.core);
  });
});

describe('fallbackOf', () => {
  it('names who failed, who is next and why, only while falling back', () => {
    const rig = makeRig(CEILINGS);
    const j = newJournal(
      planFor(rig, CEILINGS, [
        ['b1', 22000],
        ['b2', 21000],
      ]),
    );
    expect(fallbackOf(j)).toBeNull();
    j.state = 'FALLBACK_RUNNER_UP';
    expect(fallbackOf(j)).toBeNull(); // nothing failed yet
    j.failed.push({ bidderId: 'b1', reason: 'declined' });
    expect(fallbackOf(j)).toEqual({ fromBidderId: 'b1', toBidderId: 'b2', reason: 'declined' });
    j.cursor = 1;
    j.failed.push({ bidderId: 'b2', reason: 'hold_expired' });
    expect(fallbackOf(j)).toEqual({ fromBidderId: 'b2', toBidderId: null, reason: 'hold_expired' });
  });
});
