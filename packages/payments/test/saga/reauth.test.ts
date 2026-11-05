import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/fake/core.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { buildRequestId } from '../../src/requestId.js';
import { runCapturePhase } from '../../src/saga/capture.js';
import {
  DEFAULT_HONOR_SAFE_MS,
  DEFAULT_REAUTH_POLICY,
  persistReauthorization,
  reauthDue,
  reauthorizeIfDue,
  type ReauthHold,
  type ReauthPolicy,
} from '../../src/saga/reauth.js';
import { CEILINGS, START_MS, makeRig, seed, type Rig } from './rig.js';

const ON: ReauthPolicy = { enabled: true, honorSafeMs: DEFAULT_HONOR_SAFE_MS };

function holdOf(rig: Rig, generation = 0): ReauthHold {
  return {
    holdId: 'hold-b1',
    authId: rig.auth['b1'] ?? '',
    ceilingCents: CEILINGS.b1,
    startedAtMs: START_MS,
    generation,
  };
}

function reauthCalls(rig: Rig): number {
  return rig.core.calls.filter((c) => c.op === 'reauthorize').length;
}

describe('T-PAY-051 reauthorization policy (R-PAY-070, R-PAY-071, R-PAY-072)', () => {
  it('is off by default and makes no call', async () => {
    const rig = makeRig(CEILINGS);
    rig.clock.advance(3 * DAY_MS + 3_600_000);
    expect(DEFAULT_REAUTH_POLICY.enabled).toBe(false);
    const r = await reauthorizeIfDue(rig.deps, 'auc1', holdOf(rig));
    expect(r).toEqual({ status: 'disabled' });
    expect(reauthCalls(rig)).toBe(0);
    expect(rig.audits).toHaveLength(0);
  });

  it('hold age 3d 1h, disabled: capture proceeds and no reauthorization happens', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.clock.advance(3 * DAY_MS + 3_600_000);
    await reauthorizeIfDue(rig.deps, 'auc1', holdOf(rig), { ...ON, enabled: false });
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('captured');
    expect(reauthCalls(rig)).toBe(0);
    assertFakeInvariants(rig.core);
  });

  it('hold age 3d 1h, enabled: reauthorizes once with the same ceiling, then capture proceeds', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.clock.advance(3 * DAY_MS + 3_600_000);
    const r = await reauthorizeIfDue(rig.deps, 'auc1', holdOf(rig), ON);
    expect(r).toEqual({
      status: 'reauthorized',
      authId: expect.stringMatching(/^AUTH-/),
      previousAuthId: rig.auth['b1'],
      ceilingCents: CEILINGS.b1,
      startedAtMs: START_MS + 3 * DAY_MS + 3_600_000,
      generation: 1,
    });
    if (r.status !== 'reauthorized') return;
    expect(r.authId).not.toBe(rig.auth['b1']);
    // R11-O06: the caller stores the new id before the capture.
    await persistReauthorization(rig.deps, 'auc1', 'hold-b1', r);
    expect(reauthCalls(rig)).toBe(1);
    expect(rig.core.inspect(rig.auth['b1'] ?? '').reauths).toBe(1);
    const call = rig.audits.find((a) => a.op === 'reauth');
    expect(call?.requestId).toBe(
      buildRequestId({
        auctionId: 'auc1',
        op: 'reauth',
        holdId: 'hold-b1',
        amountCents: CEILINGS.b1,
        generation: 1,
      }),
    );
    expect(call?.label).toBe('reauthorized');

    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('captured');
    if (out.status !== 'captured') return;
    expect(out.journal.winner?.bidderId).toBe('b1');
    expect(rig.core.inspect(r.authId).capturedCents).toBe(22000);
    assertFakeInvariants(rig.core);
  });

  it('R11-O06 stores the new id in the journal and keeps the old one for the audit', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.clock.advance(3 * DAY_MS + 3_600_000);
    const r = await reauthorizeIfDue(rig.deps, 'auc1', holdOf(rig), ON);
    if (r.status !== 'reauthorized') throw new Error('not reauthorized');
    const journal = await rig.journals.load('auc1');
    expect(journal?.holds['b1']?.authId).toBe(rig.auth['b1']);
    await persistReauthorization(rig.deps, 'auc1', 'hold-b1', r);
    const saved = await rig.journals.load('auc1');
    expect(saved?.holds['b1']).toMatchObject({
      authId: r.authId,
      priorAuthIds: [rig.auth['b1']],
    });
    // Repeating it changes nothing.
    const version = saved?.version;
    await persistReauthorization(rig.deps, 'auc1', 'hold-b1', r);
    expect((await rig.journals.load('auc1'))?.version).toBe(version);
  });

  it('a young hold is left alone', async () => {
    const rig = makeRig(CEILINGS);
    rig.clock.advance(2 * 3_600_000);
    const r = await reauthorizeIfDue(rig.deps, 'auc1', holdOf(rig), ON);
    expect(r).toEqual({ status: 'not_due' });
    expect(reauthCalls(rig)).toBe(0);
  });

  it('age is compared strictly against honorSafeMs', () => {
    const hold: ReauthHold = {
      holdId: 'h',
      authId: 'a',
      ceilingCents: 100,
      startedAtMs: 0,
      generation: 0,
    };
    expect(reauthDue(ON, hold, DEFAULT_HONOR_SAFE_MS)).toBe(false);
    expect(reauthDue(ON, hold, DEFAULT_HONOR_SAFE_MS + 1)).toBe(true);
    expect(reauthDue({ ...ON, enabled: false }, hold, 10 * DAY_MS)).toBe(false);
  });

  it('a refusal is reported, audited, and does not stop the capture', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    // Past the policy threshold but inside the fake's honor period: PayPal says too early.
    rig.clock.advance(3 * DAY_MS - 3_600_000);
    const r = await reauthorizeIfDue(rig.deps, 'auc1', holdOf(rig), ON);
    expect(r.status).toBe('refused');
    expect(rig.audits.find((a) => a.op === 'reauth')?.outcome).toBe('definite');
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('captured');
    assertFakeInvariants(rig.core);
  });
});
