import { describe, expect, it } from 'vitest';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { runSettlement } from '../../src/saga/void.js';
import { CEILINGS, makeRig, seed } from './rig.js';

describe('R8-P06 a settlement that fails review releases the holds that are not in doubt', () => {
  it('after an unknown capture past the deadline the losers are voided and the winner is not', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.core.inject('capture', 'timeout_before', rig.auth['b1'] ?? '', 10);
    expect((await runSettlement(rig.deps, 'auc1')).status).toBe('pending');
    rig.clock.advance(601_000);
    const out = await runSettlement(rig.deps, 'auc1');
    expect(out).toMatchObject({ status: 'failed', reason: 'capture_outcome_unknown' });
    if (out.status !== 'failed') return;
    expect(out.journal.state).toBe('FAILED_NEEDS_REVIEW');
    // The hold of the capture in doubt is untouched; every other hold is released.
    expect(rig.core.inspect(rig.auth['b1'] ?? '').voidEffects).toBe(0);
    expect(rig.core.inspect(rig.auth['b2'] ?? '').voidEffects).toBe(1);
    expect(rig.core.inspect(rig.auth['b3'] ?? '').voidEffects).toBe(1);
    expect(out.journal.voids['b2']).toBe('voided');
    expect(out.journal.voids['b3']).toBe('voided');
    assertFakeInvariants(rig.core);
  });

  it('a later run does not void twice and keeps the review state', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.core.inject('capture', 'timeout_before', rig.auth['b1'] ?? '', 10);
    await runSettlement(rig.deps, 'auc1');
    rig.clock.advance(601_000);
    await runSettlement(rig.deps, 'auc1');
    const again = await runSettlement(rig.deps, 'auc1');
    expect(again.status).toBe('failed');
    expect(rig.core.inspect(rig.auth['b2'] ?? '').voidEffects).toBe(1);
    expect(rig.core.inspect(rig.auth['b3'] ?? '').voidEffects).toBe(1);
  });

  it('a hold that is already captured is not voided', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.core.inject('capture', 'timeout_before', rig.auth['b1'] ?? '', 10);
    await runSettlement(rig.deps, 'auc1');
    // An outside capture on b3 (an operator in the PayPal dashboard).
    rig.core.capture(rig.auth['b3'] ?? '', 20000, true);
    rig.clock.advance(601_000);
    await runSettlement(rig.deps, 'auc1');
    expect(rig.core.inspect(rig.auth['b3'] ?? '').voidEffects).toBe(0);
    expect(rig.core.inspect(rig.auth['b2'] ?? '').voidEffects).toBe(1);
  });
});
