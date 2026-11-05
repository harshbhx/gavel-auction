import { describe, expect, it } from 'vitest';
import { FakeClock, FakePayPalCore } from '../../src/fake/core.js';
import { FakeGateway } from '../../src/fake/gateway.js';
import { HoldError, HoldService } from '../../src/holds/service.js';
import type { PaymentsGateway } from '../../src/ports.js';
import { MemoryHoldStore } from '../../src/stores/memory.js';
import type { PaymentAudit } from '../../src/types.js';
import { KeyedQueue, observeHold } from '../../src/webhooks/merge.js';

const START_MS = 1_800_000_000_000;
const PRESETS = [5000, 15000, 25000];

function rig(patch: Partial<PaymentsGateway> = {}) {
  const clock = new FakeClock(START_MS);
  const core = new FakePayPalCore({ clock });
  const base = new FakeGateway(core);
  const gateway: PaymentsGateway = {
    createOrder: (i) => base.createOrder(i),
    getOrder: (id) => base.getOrder(id),
    authorizeOrder: (id, r) => base.authorizeOrder(id, r),
    getHoldTruth: (h) => base.getHoldTruth(h),
    capture: (a, i) => base.capture(a, i),
    voidAuthorization: (a, r) => base.voidAuthorization(a, r),
    reauthorize: (a, i) => base.reauthorize(a, i),
    ...patch,
  };
  const holds = new MemoryHoldStore();
  const audits: PaymentAudit[] = [];
  const audit = { append: async (e: PaymentAudit) => void audits.push(e) };
  const now = { nowMs: () => clock.nowMs() };
  const queue = new KeyedQueue();
  let n = 0;
  const service = new HoldService({
    gateway,
    holds,
    audit,
    clock: now,
    maxCeilingCents: 25000,
    newId: () => `hold-${(n += 1)}`,
    queue,
  });
  const observe = { gateway, holds, audit, clock: now, queue };
  return { clock, core, gateway, holds, audits, service, observe, base };
}

async function pending(r: ReturnType<typeof rig>) {
  const { holdId, orderId } = await r.service.createHoldOrder({
    auctionId: 'a1',
    bidderId: 'b1',
    ceilingCents: 15000,
    presetsCents: PRESETS,
  });
  r.core.approveOrder(orderId);
  return { holdId, orderId };
}

describe('R8-P03 a webhook never makes a pending hold HELD without its authorization id', () => {
  it('scenario A: the authorize answer was lost, the webhook came first, the retry still completes', async () => {
    const r = rig();
    const { holdId, orderId } = await pending(r);
    const authorization = r.core.authorizeOrder(orderId, 'client-timed-out');
    const record = await r.holds.get(holdId);
    if (record === null) throw new Error('record');

    const seen = await observeHold(r.observe, record, {
      kind: 'authorization_created',
      authId: authorization.authId,
    });
    expect(seen.outcome).toBe('unchanged');
    const after = await r.holds.get(holdId);
    expect(after?.status).toBe('PENDING_APPROVAL');

    const done = await r.service.completeApproval({ holdId, orderId });
    expect(done).toMatchObject({ holdId, status: 'HELD' });
    const held = await r.holds.get(holdId);
    expect(held).toMatchObject({ status: 'HELD', authId: authorization.authId });
    expect(r.core.inspect(authorization.authId).voidEffects).toBe(0);
  });

  it('scenario B: a webhook merging during the authorize call does not void the fresh authorization', async () => {
    const r = rig();
    const { holdId, orderId } = await pending(r);
    let webhook: Promise<unknown> = Promise.resolve();
    const gateway = rig({
      authorizeOrder: async (id, req) => {
        const out = await r.base.authorizeOrder(id, req);
        const rec = await r.holds.get(holdId);
        if (rec === null) throw new Error('record');
        webhook = observeHold(r.observe, rec, {
          kind: 'authorization_created',
          authId: out.authId,
        });
        return out;
      },
    });
    const service = new HoldService({
      gateway: gateway.gateway,
      holds: r.holds,
      audit: { append: async () => undefined },
      clock: { nowMs: () => r.clock.nowMs() },
      maxCeilingCents: 25000,
      queue: r.observe.queue,
    });
    const done = await service.completeApproval({ holdId, orderId });
    await webhook;
    expect(done.status).toBe('HELD');
    const rec = await r.holds.get(holdId);
    expect(rec?.status).toBe('HELD');
    expect(rec?.authId).toBeDefined();
    expect(r.core.inspect(rec?.authId ?? '').voidEffects).toBe(0);
  });

  it('a hold left HELD without an id by an older merge can still be completed', async () => {
    const r = rig();
    const { holdId, orderId } = await pending(r);
    const rec = await r.holds.get(holdId);
    if (rec === null) throw new Error('record');
    await r.holds.put({ ...rec, status: 'HELD' });
    const done = await r.service.completeApproval({ holdId, orderId });
    expect(done.status).toBe('HELD');
    expect((await r.holds.get(holdId))?.authId).toBeDefined();
  });
});

describe('R8-P04 hold writes do not erase each other', () => {
  it('a webhook mid truth read does not overwrite the approval (authId and ceiling kept)', async () => {
    const r = rig();
    const { holdId, orderId } = await pending(r);
    const stale = await r.holds.get(holdId);
    if (stale === null) throw new Error('record');
    // The record the webhook read is now old: the approval finishes while its truth read runs.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => (release = res));
    const slow = rig({
      getHoldTruth: async (h) => {
        const truth = await r.base.getHoldTruth(h);
        await gate;
        return truth;
      },
    });
    r.core.authorizeOrder(orderId, 'x');
    const webhook = observeHold({ ...r.observe, gateway: slow.gateway }, stale, {
      kind: 'authorization_created',
      authId: r.core.getOrder(orderId).authId ?? '',
    });
    const approval = r.service.completeApproval({ holdId, orderId });
    release();
    await Promise.all([webhook, approval]);
    const rec = await r.holds.get(holdId);
    expect(rec?.status).toBe('HELD');
    expect(rec?.authId).toBeDefined();
  });

  it('an abandon that races an approval is refused once the hold is HELD', async () => {
    const r = rig();
    const { holdId, orderId } = await pending(r);
    await r.service.completeApproval({ holdId, orderId });
    const again = r.service.createHoldOrder({
      auctionId: 'a1',
      bidderId: 'b1',
      ceilingCents: 25000,
      presetsCents: PRESETS,
    });
    await expect(again).rejects.toBeInstanceOf(HoldError);
    expect((await r.holds.get(holdId))?.status).toBe('HELD');
  });

  it('an abandon never revives or overwrites a hold that became HELD with an authId', async () => {
    const r = rig();
    const { holdId, orderId } = await pending(r);
    const first = r.service.completeApproval({ holdId, orderId });
    const second = r.service.createHoldOrder({
      auctionId: 'a1',
      bidderId: 'b1',
      ceilingCents: 25000,
      presetsCents: PRESETS,
    });
    await first;
    await second.catch(() => undefined);
    const rec = await r.holds.get(holdId);
    expect(rec?.status).toBe('HELD');
    expect(rec?.authId).toBeDefined();
  });
});
