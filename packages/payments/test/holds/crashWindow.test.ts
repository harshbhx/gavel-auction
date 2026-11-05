import { describe, expect, it } from 'vitest';
import { FakeClock, FakePayPalCore } from '../../src/fake/core.js';
import { FakeGateway } from '../../src/fake/gateway.js';
import { HoldError, HoldService } from '../../src/holds/service.js';
import { sweepStalePending, type RecoverDeps } from '../../src/holds/recover.js';
import { MemoryHoldStore } from '../../src/stores/memory.js';
import type { PaymentAudit } from '../../src/types.js';

const START_MS = 1_800_000_000_000;
const PRESETS = [5000, 15000, 25000];

function rig() {
  const clock = new FakeClock(START_MS);
  const core = new FakePayPalCore({ clock });
  const gateway = new FakeGateway(core);
  const holds = new MemoryHoldStore();
  const audit = { append: async (_e: PaymentAudit) => undefined };
  const now = { nowMs: () => clock.nowMs() };
  let n = 0;
  const service = new HoldService({
    gateway,
    holds,
    audit,
    clock: now,
    maxCeilingCents: 25000,
    newId: () => `hold-${(n += 1)}`,
  });
  const deps: RecoverDeps = {
    gateway,
    holds,
    audit,
    clock: now,
    service,
    isAuctionOpen: async () => true,
  };
  return { clock, core, gateway, holds, service, deps };
}

/** The order is approved and PayPal authorized it, then the process died before the HELD write. */
async function crashAfterAuthorize(r: ReturnType<typeof rig>) {
  const created = await r.service.createHoldOrder({
    auctionId: 'a1',
    bidderId: 'b1',
    ceilingCents: 15000,
    presetsCents: PRESETS,
  });
  r.core.approveOrder(created.orderId);
  const auth = await r.gateway.authorizeOrder(created.orderId, 'req-lost');
  return { ...created, authId: auth.authId };
}

describe('HRD-16 crash between authorize and the HELD write', () => {
  it('abandoning the pending record voids the live authorization first', async () => {
    const r = rig();
    const first = await crashAfterAuthorize(r);
    r.clock.advance(60_000);
    const second = await r.service.createHoldOrder({
      auctionId: 'a1',
      bidderId: 'b1',
      ceilingCents: 25000,
      presetsCents: PRESETS,
    });
    expect(second.holdId).not.toBe(first.holdId);
    expect(r.core.getAuthorization(first.authId).status).toBe('VOIDED');
    const rec = await r.holds.get(first.holdId);
    expect(rec?.status).toBe('EXPIRED');
    expect(rec?.authId).toBe(first.authId);
  });

  it('a PayPal outage while reading the order creates no second order', async () => {
    const r = rig();
    const first = await crashAfterAuthorize(r);
    r.core.inject('get', 'http_500');
    await expect(
      r.service.createHoldOrder({
        auctionId: 'a1',
        bidderId: 'b1',
        ceilingCents: 25000,
        presetsCents: PRESETS,
      }),
    ).rejects.toBeInstanceOf(HoldError);
    expect((await r.holds.listByAuction('a1')).length).toBe(1);
    expect((await r.holds.get(first.holdId))?.status).toBe('PENDING_APPROVAL');
  });

  it('a failed void leaves the record pending, so nothing is left untracked', async () => {
    const r = rig();
    const first = await crashAfterAuthorize(r);
    r.core.inject('void', 'http_500');
    await expect(
      r.service.createHoldOrder({
        auctionId: 'a1',
        bidderId: 'b1',
        ceilingCents: 25000,
        presetsCents: PRESETS,
      }),
    ).rejects.toBeInstanceOf(HoldError);
    expect((await r.holds.get(first.holdId))?.status).toBe('PENDING_APPROVAL');
    expect(r.core.getAuthorization(first.authId).status).toBe('CREATED');
  });

  it('the sweep voids an authorization behind an expired record without an id', async () => {
    const r = rig();
    const first = await crashAfterAuthorize(r);
    const pending = await r.holds.get(first.holdId);
    if (pending === null) throw new Error('missing record');
    // State left by an earlier abandon that never asked PayPal.
    await r.holds.put({ ...pending, status: 'EXPIRED' });
    r.clock.advance(60_000);
    const out = await sweepStalePending(r.deps, 'a1', 0);
    expect(out.map((o) => o.holdId)).toContain(first.holdId);
    expect(r.core.getAuthorization(first.authId).status).toBe('VOIDED');
    expect((await r.holds.get(first.holdId))?.authId).toBe(first.authId);
    // A second sweep finds nothing left to do.
    expect(await sweepStalePending(r.deps, 'a1', 0)).toEqual([]);
  });

  it('the sweep adopts an authorization on a pending record while the auction is open', async () => {
    const r = rig();
    const first = await crashAfterAuthorize(r);
    r.clock.advance(60_000);
    const out = await sweepStalePending(r.deps, 'a1', 1000);
    expect(out[0]?.result.status).toBe('authorized');
    expect((await r.holds.get(first.holdId))?.authId).toBe(first.authId);
  });
});
