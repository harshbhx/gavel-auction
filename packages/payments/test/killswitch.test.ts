import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PayPalError } from '../src/errors.js';
import {
  FileKillStateStore,
  MemoryKillStateStore,
  PersistentKillSwitch,
  assertNotEngaged,
  guardGateway,
} from '../src/killswitch.js';
import type { PaymentsGateway } from '../src/ports.js';
import type { PaymentAudit } from '../src/types.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function mk(now = 1000): { ks: PersistentKillSwitch; audit: PaymentAudit[]; clock: { t: number } } {
  const audit: PaymentAudit[] = [];
  const clock = { t: now };
  const ks = new PersistentKillSwitch({
    store: new MemoryKillStateStore(),
    audit: {
      append: async (e) => {
        audit.push(e);
      },
    },
    clock: { nowMs: () => clock.t },
  });
  return { ks, audit, clock };
}

/** A gateway that counts every call; stands in for "the network". */
function countingGateway(): { gw: PaymentsGateway; calls: string[] } {
  const calls: string[] = [];
  const gw: PaymentsGateway = {
    async createOrder() {
      calls.push('createOrder');
      return { orderId: 'O1' };
    },
    async getOrder(orderId) {
      calls.push('getOrder');
      return { orderId, status: 'CREATED' };
    },
    async authorizeOrder() {
      calls.push('authorizeOrder');
      return { authId: 'A1', amountCents: 100 };
    },
    async getHoldTruth(h) {
      calls.push('getHoldTruth');
      return {
        holdId: h.holdId,
        authId: h.authId,
        status: 'CREATED',
        amountCents: 100,
        capturedCents: 0,
        captures: [],
        observedAtMs: 0,
      };
    },
    async capture() {
      calls.push('capture');
      return { captureId: 'C1', amountCents: 100 };
    },
    async voidAuthorization() {
      calls.push('voidAuthorization');
    },
    async reauthorize() {
      calls.push('reauthorize');
      return { amountCents: 100 };
    },
  };
  return { gw, calls };
}

async function refusal(p: Promise<unknown>): Promise<PayPalError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PayPalError) return e;
    throw e;
  }
  throw new Error('expected a refusal');
}

const ORDER = { holdId: 'h', ceilingCents: 100, description: 'd', requestId: 'r' };
const CAPTURE = { amountCents: 100, finalCapture: true, invoiceId: 'i', requestId: 'r' };

describe('T-PAY-027 engaged switch blocks money-moving calls', () => {
  it('createOrder and authorizeOrder refuse with kill_switch_engaged and make no call', async () => {
    const { ks } = mk();
    const { gw, calls } = countingGateway();
    const guarded = guardGateway(gw, ks);
    await ks.engage('incident', 'harsh');

    const a = await refusal(guarded.createOrder(ORDER));
    const b = await refusal(guarded.authorizeOrder('O1', 'r'));
    expect(a.kind).toBe('kill_switch_engaged');
    expect(b.kind).toBe('kill_switch_engaged');
    expect(a.outcome).toBe('definite');
    expect(a.message).toContain('incident');
    expect(calls).toEqual([]);
  });

  it('capture and reauthorize refuse too', async () => {
    const { ks } = mk();
    const { gw, calls } = countingGateway();
    const guarded = guardGateway(gw, ks);
    await ks.engage('incident', 'harsh');
    expect((await refusal(guarded.capture('A1', CAPTURE))).kind).toBe('kill_switch_engaged');
    expect(
      (await refusal(guarded.reauthorize('A1', { amountCents: 1, requestId: 'r' }))).kind,
    ).toBe('kill_switch_engaged');
    expect(calls).toEqual([]);
  });

  it('void and reads still work', async () => {
    const { ks } = mk();
    const { gw, calls } = countingGateway();
    const guarded = guardGateway(gw, ks);
    await ks.engage('incident', 'harsh');
    await guarded.voidAuthorization('A1', 'r');
    await guarded.getOrder('O1');
    await guarded.getHoldTruth({ holdId: 'h', authId: 'A1' });
    expect(calls).toEqual(['voidAuthorization', 'getOrder', 'getHoldTruth']);
  });

  it('everything passes while released, and again after release', async () => {
    const { ks } = mk();
    const { gw, calls } = countingGateway();
    const guarded = guardGateway(gw, ks);
    await guarded.createOrder(ORDER);
    await ks.engage('x', 'harsh');
    await refusal(guarded.createOrder(ORDER));
    await ks.release('harsh');
    await guarded.capture('A1', CAPTURE);
    expect(calls).toEqual(['createOrder', 'capture']);
  });

  it('engaging takes effect on the next call of an existing wrapper', async () => {
    const { ks } = mk();
    const { gw } = countingGateway();
    const guarded = guardGateway(gw, ks);
    expect((await guarded.createOrder(ORDER)).orderId).toBe('O1');
    await ks.engage('x', 'harsh');
    await refusal(guarded.createOrder(ORDER));
  });
});

describe('state and audit', () => {
  it('reports the engaged state with reason, actor and time', async () => {
    const { ks } = mk(4242);
    expect(await ks.isEngaged()).toEqual({ engaged: false });
    await ks.engage('stuck capture', 'ops-1');
    expect(await ks.isEngaged()).toEqual({
      engaged: true,
      reason: 'stuck capture',
      by: 'ops-1',
      sinceMs: 4242,
    });
    await ks.release('ops-2');
    expect(await ks.isEngaged()).toEqual({ engaged: false });
  });

  it('audits engage and release with the actor', async () => {
    const { ks, audit, clock } = mk(10);
    await ks.engage('r1', 'alice');
    clock.t = 20;
    await ks.release('bob');
    expect(audit).toEqual([
      { kind: 'kill_switch', label: 'engage:r1', to: 'engaged', actor: 'alice', tsMs: 10 },
      { kind: 'kill_switch', label: 'release', to: 'released', actor: 'bob', tsMs: 20 },
    ]);
  });

  it('assertNotEngaged passes when released', async () => {
    const { ks } = mk();
    await expect(assertNotEngaged(ks)).resolves.toBeUndefined();
  });
});

describe('persistence', () => {
  it('survives a restart with the file store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gavel-kill-'));
    dirs.push(dir);
    const path = join(dir, 'nested', 'kill.json');
    const audit: PaymentAudit[] = [];
    const deps = {
      audit: {
        append: async (e: PaymentAudit) => {
          audit.push(e);
        },
      },
      clock: { nowMs: () => 5 },
    };
    const before = new PersistentKillSwitch({ ...deps, store: new FileKillStateStore(path) });
    expect((await before.isEngaged()).engaged).toBe(false);
    await before.engage('maintenance', 'harsh');

    const after = new PersistentKillSwitch({ ...deps, store: new FileKillStateStore(path) });
    expect(await after.isEngaged()).toEqual({
      engaged: true,
      reason: 'maintenance',
      by: 'harsh',
      sinceMs: 5,
    });
    await after.release('harsh');
    const third = new PersistentKillSwitch({ ...deps, store: new FileKillStateStore(path) });
    expect((await third.isEngaged()).engaged).toBe(false);
  });

  it('a kill file with the wrong shape or broken JSON reads as engaged and blocks money calls', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gavel-kill-'));
    dirs.push(dir);
    for (const text of ['{}', '{"engaged":0}', '{"engaged":"no"}', '{"engaged":fal', '[]', '']) {
      const path = join(dir, 'kill.json');
      writeFileSync(path, text);
      const ks = new PersistentKillSwitch({
        store: new FileKillStateStore(path),
        audit: { append: async () => undefined },
        clock: { nowMs: () => 1 },
      });
      expect((await ks.isEngaged()).engaged, text).toBe(true);
      const err = await assertNotEngaged(ks).catch((e: unknown) => e);
      expect(err, text).toBeInstanceOf(PayPalError);
      expect((err as PayPalError).kind).toBe('kill_switch_engaged');
    }
  });

  it('stays engaged even when the audit sink fails', async () => {
    const store = new MemoryKillStateStore();
    const ks = new PersistentKillSwitch({
      store,
      audit: {
        append: async () => {
          throw new Error('audit down');
        },
      },
      clock: { nowMs: () => 1 },
    });
    await expect(ks.engage('x', 'harsh')).rejects.toThrow('audit down');
    expect((await store.load()).engaged).toBe(true);
  });
});
