import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/fake/core.js';
import { FakeControlServer } from '../../src/fake/control.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { FakePayPalServer } from '../../src/fake/server.js';
import { PayPalGateway } from '../../src/gateway.js';
import { HoldError, HoldService, type HoldServiceDeps } from '../../src/holds/service.js';
import { TokenManager } from '../../src/oauth.js';
import type { KillSwitch, PaymentsGateway } from '../../src/ports.js';
import { MemoryHoldStore } from '../../src/stores/memory.js';
import { Transport } from '../../src/transport.js';
import type { PaymentAudit } from '../../src/types.js';

const noSleep = async (): Promise<void> => undefined;
const START_MS = 1_800_000_000_000;
const PRESETS = [5000, 15000, 25000];

interface Counts {
  createOrder: number;
  authorizeOrder: number;
}

interface Rig {
  server: FakePayPalServer;
  control: FakeControlServer;
  clock: FakeClock;
  holds: MemoryHoldStore;
  audits: PaymentAudit[];
  counts: Counts;
  service: HoldService;
  engaged: { value: boolean };
  approve(orderId: string): Promise<void>;
  close(): Promise<void>;
}

async function makeRig(opts: { maxAttempts?: number; pendingTtlMs?: number } = {}): Promise<Rig> {
  const clock = new FakeClock(START_MS);
  const server = new FakePayPalServer({ core: { clock }, timers: { sleep: noSleep } });
  await server.start();
  const control = new FakeControlServer(server, { sleep: noSleep });
  await control.start();
  const transport = new Transport({
    sleep: noSleep,
    ...(opts.maxAttempts === undefined ? {} : { maxAttempts: opts.maxAttempts }),
  });
  const auth = new TokenManager({
    transport,
    baseUrl: server.url,
    clientId: 'fake-client',
    clientSecret: 'fake-secret-value',
  });
  const engaged = { value: false };
  const killSwitch: KillSwitch = {
    isEngaged: async () => (engaged.value ? { engaged: true, reason: 'test' } : { engaged: false }),
    engage: async () => undefined,
    release: async () => undefined,
  };
  const real = new PayPalGateway({
    auth,
    fake: true,
    clock: { nowMs: () => clock.nowMs() },
    killSwitch,
  });
  const counts: Counts = { createOrder: 0, authorizeOrder: 0 };
  const gateway: PaymentsGateway = {
    createOrder: (i) => {
      counts.createOrder += 1;
      return real.createOrder(i);
    },
    getOrder: (id) => real.getOrder(id),
    authorizeOrder: (id, r) => {
      counts.authorizeOrder += 1;
      return real.authorizeOrder(id, r);
    },
    getHoldTruth: (h) => real.getHoldTruth(h),
    capture: (a, i) => real.capture(a, i),
    voidAuthorization: (a, r) => real.voidAuthorization(a, r),
    reauthorize: (a, i) => real.reauthorize(a, i),
  };
  const holds = new MemoryHoldStore();
  const audits: PaymentAudit[] = [];
  let n = 0;
  const deps: HoldServiceDeps = {
    gateway,
    holds,
    audit: { append: async (e) => void audits.push(e) },
    clock: { nowMs: () => clock.nowMs() },
    maxCeilingCents: 25000,
    newId: () => `hold-${(n += 1)}`,
    ...(opts.pendingTtlMs === undefined ? {} : { pendingTtlMs: opts.pendingTtlMs }),
  };
  return {
    server,
    control,
    clock,
    holds,
    audits,
    counts,
    service: new HoldService(deps),
    engaged,
    approve: async (orderId) => {
      const res = await fetch(`${control.url}/__fake/approve/${orderId}`, { method: 'POST' });
      expect(res.status).toBe(200);
    },
    close: async () => {
      await control.stop();
      await server.stop();
    },
  };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HoldError) return e.code;
    throw e;
  }
  throw new Error('expected a HoldError');
}

const create = (r: Rig, bidderId = 'b1', ceilingCents = 15000) =>
  r.service.createHoldOrder({ auctionId: 'a1', bidderId, ceilingCents, presetsCents: PRESETS });

let rig: Rig;
beforeEach(async () => {
  rig = await makeRig();
});
afterEach(async () => {
  assertFakeInvariants(rig.server.core);
  await rig.close();
});

describe('PAYMENTS-R3-08 concurrent createHoldOrder', () => {
  it('creates one order for two simultaneous calls of one bidder', async () => {
    const [a, b] = await Promise.all([create(rig), create(rig)]);
    expect(b).toEqual(a);
    expect(rig.counts.createOrder).toBe(1);
    expect(await rig.holds.listByAuction('a1')).toHaveLength(1);
  });

  it('still creates separate orders for different bidders', async () => {
    await Promise.all([create(rig, 'b1'), create(rig, 'b2')]);
    expect(rig.counts.createOrder).toBe(2);
  });
});

describe('T-PAY-020 create, approve, complete', () => {
  it('stores the authorization id PayPal returned and ignores one from the browser', async () => {
    const { holdId, orderId } = await create(rig);
    const pending = await rig.holds.get(holdId);
    expect(pending).toMatchObject({
      status: 'PENDING_APPROVAL',
      orderId,
      ceilingCents: 15000,
      bidderId: 'b1',
      auctionId: 'a1',
      createdAtMs: START_MS,
    });
    expect(pending?.authId).toBeUndefined();

    await rig.approve(orderId);
    const evil = { holdId, orderId, authId: 'AUTH-EVIL', ceilingCents: 1 } as never;
    const approved = await rig.service.completeApproval(evil);
    expect(approved).toEqual({ holdId, status: 'HELD', ceilingCents: 15000 });

    const stored = await rig.holds.get(holdId);
    const orderAtFake = rig.server.core.getOrder(orderId);
    expect(stored?.status).toBe('HELD');
    expect(stored?.authId).toBe(orderAtFake.authId);
    expect(stored?.authId).not.toBe('AUTH-EVIL');
    expect(rig.server.core.getAuthorization(stored?.authId ?? '').holdCents).toBe(15000);
  });

  it('sends the validated ceiling to PayPal, and audits each step', async () => {
    const { holdId, orderId } = await create(rig, 'b1', 25000);
    expect(rig.server.core.getOrder(orderId).amountCents).toBe(25000);
    await rig.approve(orderId);
    await rig.service.completeApproval({ holdId, orderId });
    const changes = rig.audits.filter((a) => a.kind === 'state_change');
    expect(changes.map((a) => a.label)).toEqual(['hold_created', 'hold_authorized']);
    expect(changes[1]).toMatchObject({ holdId, from: 'PENDING_APPROVAL', to: 'HELD' });
    // RT4-saga-04: each money call has its own row, written before the state change it led to.
    expect(rig.audits.map((a) => [a.kind, a.op ?? a.label])).toEqual([
      ['paypal_call', 'order'],
      ['state_change', 'hold_created'],
      ['paypal_call', 'authorize'],
      ['state_change', 'hold_authorized'],
    ]);
    for (const call of rig.audits.filter((a) => a.kind === 'paypal_call')) {
      expect(call).toMatchObject({ auctionId: 'a1', holdId, outcome: 'definite', label: 'ok' });
      expect(call.requestId).toMatch(/\S/);
    }
  });

  it('refuses a ceiling outside the minimum and the cap before any PayPal call', async () => {
    for (const c of [0, -5, 99, 30000, 150.5]) {
      expect(await codeOf(create(rig, 'b1', c))).toBe('ceiling_out_of_range');
    }
    expect(rig.counts.createOrder).toBe(0);
    expect(await rig.holds.listByAuction('a1')).toEqual([]);
  });

  it('refuses an approval that is not for the hold, or that has not happened', async () => {
    const { holdId, orderId } = await create(rig);
    expect(await codeOf(rig.service.completeApproval({ holdId, orderId: 'OTHER' }))).toBe(
      'order_not_found',
    );
    expect(await codeOf(rig.service.completeApproval({ holdId: 'nope', orderId }))).toBe(
      'order_not_found',
    );
    expect(await codeOf(rig.service.completeApproval({ holdId, orderId }))).toBe(
      'order_not_approved',
    );
    expect((await rig.holds.get(holdId))?.status).toBe('PENDING_APPROVAL');
    // Once the buyer approves, the same hold completes.
    await rig.approve(orderId);
    await expect(rig.service.completeApproval({ holdId, orderId })).resolves.toMatchObject({
      status: 'HELD',
    });
  });
});

describe('T-PAY-021 create is idempotent per bidder', () => {
  it('returns the same order while one is pending', async () => {
    const a = await create(rig);
    const b = await create(rig);
    expect(b).toEqual(a);
    expect(rig.counts.createOrder).toBe(1);
  });

  it('answers hold_exists after HELD', async () => {
    const { holdId, orderId } = await create(rig);
    await rig.approve(orderId);
    await rig.service.completeApproval({ holdId, orderId });
    expect(await codeOf(create(rig))).toBe('hold_exists');
    expect(rig.counts.createOrder).toBe(1);
  });

  it('keeps bidders apart', async () => {
    const a = await create(rig, 'b1');
    const b = await create(rig, 'b2');
    expect(b.holdId).not.toBe(a.holdId);
    expect(b.orderId).not.toBe(a.orderId);
  });

  it('abandons a pending order for another amount and opens a new one', async () => {
    const a = await create(rig, 'b1', 5000);
    const b = await create(rig, 'b1', 15000);
    expect(b.orderId).not.toBe(a.orderId);
    expect((await rig.holds.get(a.holdId))?.status).toBe('EXPIRED');
    expect((await rig.holds.get(b.holdId))?.status).toBe('PENDING_APPROVAL');
    expect(await create(rig, 'b1', 15000)).toEqual(b);
  });

  it('opens a new order once the pending one has lapsed', async () => {
    const a = await create(rig);
    rig.clock.advance(3 * 60 * 60 * 1000 + 1);
    const b = await create(rig);
    expect(b.orderId).not.toBe(a.orderId);
    expect((await rig.holds.get(a.holdId))?.status).toBe('EXPIRED');
  });

  it('allows a new hold after the old one was voided', async () => {
    const a = await create(rig);
    const hold = await rig.holds.get(a.holdId);
    if (hold === null) throw new Error('hold missing');
    await rig.holds.put({ ...hold, status: 'VOIDED' });
    const b = await create(rig);
    expect(b.holdId).not.toBe(a.holdId);
  });
});

describe('T-PAY-022 completeApproval is idempotent', () => {
  it('a second call returns the same hold with no second authorize', async () => {
    const { holdId, orderId } = await create(rig);
    await rig.approve(orderId);
    const first = await rig.service.completeApproval({ holdId, orderId });
    const second = await rig.service.completeApproval({ holdId, orderId });
    expect(second).toEqual(first);
    expect(rig.counts.authorizeOrder).toBe(1);
    expect(rig.server.core.authCount()).toBe(1);
  });

  it('concurrent calls share one authorize', async () => {
    const { holdId, orderId } = await create(rig);
    await rig.approve(orderId);
    const [a, b] = await Promise.all([
      rig.service.completeApproval({ holdId, orderId }),
      rig.service.completeApproval({ holdId, orderId }),
    ]);
    expect(a).toEqual(b);
    expect(rig.counts.authorizeOrder).toBe(1);
    expect(rig.server.core.authCount()).toBe(1);
  });

  it('survives authorize timeout_after_success once: one authorization, same hold', async () => {
    const { holdId, orderId } = await create(rig);
    await rig.approve(orderId);
    rig.server.faults.add({ kind: 'timeout_after_success', op: 'authorize' });
    const approved = await rig.service.completeApproval({ holdId, orderId });
    expect(approved.status).toBe('HELD');
    expect(rig.server.core.authCount()).toBe(1);
    const again = await rig.service.completeApproval({ holdId, orderId });
    expect(again).toEqual(approved);
    expect(rig.server.core.authCount()).toBe(1);
  });

  it('adopts the authorization when every answer was lost', async () => {
    await rig.close();
    rig = await makeRig({ maxAttempts: 2 });
    const { holdId, orderId } = await create(rig);
    await rig.approve(orderId);
    rig.server.faults.add({ kind: 'timeout_after_success', op: 'authorize', times: 5 });
    const approved = await rig.service.completeApproval({ holdId, orderId });
    expect(approved).toMatchObject({ holdId, status: 'HELD' });
    expect(rig.server.core.authCount()).toBe(1);
    expect((await rig.holds.get(holdId))?.authId).toBe(rig.server.core.getOrder(orderId).authId);
  });

  it('keeps the hold pending when PayPal is unavailable and no authorization exists', async () => {
    await rig.close();
    rig = await makeRig({ maxAttempts: 2 });
    const { holdId, orderId } = await create(rig);
    await rig.approve(orderId);
    rig.server.faults.add({ kind: 'http_500', op: 'authorize', times: 2 });
    expect(await codeOf(rig.service.completeApproval({ holdId, orderId }))).toBe(
      'paypal_unavailable',
    );
    expect((await rig.holds.get(holdId))?.status).toBe('PENDING_APPROVAL');
    expect(rig.server.core.authCount()).toBe(0);
    // A later retry authorizes.
    await expect(rig.service.completeApproval({ holdId, orderId })).resolves.toMatchObject({
      status: 'HELD',
    });
  });
});

describe('failures map to contract codes', () => {
  it('PayPal down on create stores nothing', async () => {
    await rig.close();
    rig = await makeRig({ maxAttempts: 2 });
    rig.server.faults.add({ kind: 'http_500', op: 'order', times: 5 });
    expect(await codeOf(create(rig))).toBe('paypal_unavailable');
    expect(await rig.holds.listByAuction('a1')).toEqual([]);
  });

  it('the kill switch stops create and authorize before PayPal is called', async () => {
    const { holdId, orderId } = await create(rig);
    await rig.approve(orderId);
    rig.engaged.value = true;
    expect(await codeOf(create(rig, 'b2'))).toBe('kill_switch_engaged');
    expect(await codeOf(rig.service.completeApproval({ holdId, orderId }))).toBe(
      'kill_switch_engaged',
    );
    expect(rig.server.core.authCount()).toBe(0);
    expect(await rig.holds.listByAuction('a1')).toHaveLength(1);
    rig.engaged.value = false;
    await expect(rig.service.completeApproval({ holdId, orderId })).resolves.toMatchObject({
      status: 'HELD',
    });
  });
});
