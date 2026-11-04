import { describe, expect, it } from 'vitest';
import { PersistentKillSwitch, MemoryKillStateStore, guardGateway } from '../../src/killswitch.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { runCapturePhase } from '../../src/saga/capture.js';
import { voidAllLiveHolds } from '../../src/saga/killswitch.js';
import { runSettlement, type SettlementDeps } from '../../src/saga/void.js';
import { CEILINGS, makeRig, seed, type Rig } from './rig.js';

function guarded(rig: Rig, store = new MemoryKillStateStore()) {
  const ks = new PersistentKillSwitch({ store, audit: rig.deps.audit, clock: rig.deps.clock });
  const deps: SettlementDeps = {
    ...rig.deps,
    gateway: guardGateway(rig.gw, ks),
    killSwitch: ks,
  };
  return { ks, deps, store };
}

function totalCaptured(rig: Rig): number {
  return Object.values(rig.auth).reduce((s, id) => s + rig.core.inspect(id).capturedCents, 0);
}

describe('T-PAY-048 kill switch in the runner', () => {
  it('engaged before capturing: pending(kill_switch), no capture; after release it completes', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const { ks, deps } = guarded(rig);
    await ks.engage('incident', 'ops');

    const out = await runSettlement(deps, 'auc1');
    expect(out).toMatchObject({ status: 'pending', reason: 'kill_switch' });
    if (out.status !== 'pending') return;
    expect(out.journal.state).toBe('CAPTURING');
    expect(totalCaptured(rig)).toBe(0);
    expect(rig.core.calls.filter((c) => c.op === 'capture')).toHaveLength(0);

    // Asking again while engaged changes nothing.
    expect(await runSettlement(deps, 'auc1')).toMatchObject({ reason: 'kill_switch' });

    await ks.release('ops');
    const done = await runSettlement(deps, 'auc1');
    expect(done.status).toBe('settled');
    expect(totalCaptured(rig)).toBe(22000);
    assertFakeInvariants(rig.core);
  });

  it('engaged right after the capture: the voids still run and the settlement completes', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const { ks, deps } = guarded(rig);
    const out = await runSettlement(
      {
        ...deps,
        boundary: async (label) => {
          if (label === 'after:capture') await ks.engage('incident', 'ops');
        },
      },
      'auc1',
    );
    expect((await ks.isEngaged()).engaged).toBe(true);
    expect(out.status).toBe('settled');
    expect(totalCaptured(rig)).toBe(22000);
    for (const b of ['b2', 'b3']) expect(rig.core.inspect(rig.auth[b] ?? '').voidEffects).toBe(1);
    assertFakeInvariants(rig.core);
  });
});

describe('T-PAY-073 voidAllLiveHolds', () => {
  it('engage, restart on the same store, void all: still engaged, voids audited with the actor', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    const first = guarded(rig);
    await first.ks.engage('incident', 'ops');
    await runSettlement(first.deps, 'auc1'); // pending(kill_switch)

    const second = guarded(rig, first.store); // a new instance on the same store
    expect(await second.ks.isEngaged()).toMatchObject({ engaged: true, reason: 'incident' });

    const out = await voidAllLiveHolds(second.deps, 'auc1', 'admin-7');
    expect(out.status).toBe('done');
    if (out.status !== 'done') return;
    expect(out.holds).toEqual({ b1: 'voided', b2: 'voided', b3: 'voided' });
    expect(out.journal.voids).toEqual({ b1: 'voided', b2: 'voided', b3: 'voided' });
    expect((await second.ks.isEngaged()).engaged).toBe(true);

    const audits = rig.audits.filter((a) => a.kind === 'void_all');
    expect(audits).toHaveLength(3);
    expect(audits.every((a) => a.actor === 'admin-7')).toBe(true);

    // Asking again repeats nothing.
    const calls = rig.core.calls.length;
    await voidAllLiveHolds(second.deps, 'auc1', 'admin-7');
    expect(rig.core.calls.length).toBe(calls);

    // After the release the settlement ends with no sale.
    await second.ks.release('ops');
    const done = await runSettlement(second.deps, 'auc1');
    expect(done.status).toBe('settled');
    if (done.status !== 'settled') return;
    expect(done.journal.winner).toBeNull();
    expect(totalCaptured(rig)).toBe(0);
    assertFakeInvariants(rig.core);
  });

  it('never voids a captured hold', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    await runCapturePhase(rig.deps, 'auc1');
    const out = await voidAllLiveHolds(rig.deps, 'auc1', 'admin-7');
    expect(out.status).toBe('done');
    if (out.status !== 'done') return;
    expect(out.holds).toEqual({ b1: 'captured', b2: 'voided', b3: 'voided' });
    expect(rig.core.inspect(rig.auth['b1'] ?? '')).toMatchObject({
      capturedCents: 22000,
      voidEffects: 0,
    });
    // The settlement then completes without voiding the other two again.
    const done = await runSettlement(rig.deps, 'auc1');
    expect(done.status).toBe('settled');
    for (const b of ['b2', 'b3']) expect(rig.core.inspect(rig.auth[b] ?? '').voidEffects).toBe(1);
  });

  it('answers busy while a runner holds the lease', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    expect(await rig.journals.acquireLease('auc1', 'runner', 30_000, 1_800_000_000_000)).toBe(true);
    expect(await voidAllLiveHolds(rig.deps, 'auc1', 'admin-7')).toEqual({ status: 'busy' });
  });
});
