import { describe, expect, it } from 'vitest';
import { FakeClock, FakePayPalCore } from '../../src/fake/core.js';
import { FakeGateway } from '../../src/fake/gateway.js';
import { HoldService } from '../../src/holds/service.js';
import { MemoryHoldStore } from '../../src/stores/memory.js';

function rig() {
  const clock = new FakeClock(1_800_000_000_000);
  const core = new FakePayPalCore({ clock });
  const holds = new MemoryHoldStore();
  const service = new HoldService({
    gateway: new FakeGateway(core),
    holds,
    audit: { append: async () => undefined },
    clock: { nowMs: () => clock.nowMs() },
    maxCeilingCents: 25000,
  });
  return { core, holds, service };
}

const input = { auctionId: 'a1', bidderId: 'b1', ceilingCents: 15000, presetsCents: [15000] };

describe('abandonHold (browser cancel, decline, mismatch)', () => {
  it('expires a pending hold and lets the bidder start a fresh one', async () => {
    const r = rig();
    const first = await r.service.createHoldOrder(input);
    await r.service.abandonHold(first.holdId);
    expect((await r.holds.get(first.holdId))?.status).toBe('EXPIRED');
    const second = await r.service.createHoldOrder(input);
    expect(second.holdId).not.toBe(first.holdId);
  });

  it('is idempotent and ignores an unknown hold', async () => {
    const r = rig();
    const { holdId } = await r.service.createHoldOrder(input);
    await r.service.abandonHold(holdId);
    await r.service.abandonHold(holdId);
    await r.service.abandonHold('nope');
    expect((await r.holds.get(holdId))?.status).toBe('EXPIRED');
  });

  it('leaves an approved hold alone', async () => {
    const r = rig();
    const { holdId, orderId } = await r.service.createHoldOrder(input);
    r.core.approveOrder(orderId);
    await r.service.completeApproval({ holdId, orderId });
    await r.service.abandonHold(holdId);
    expect((await r.holds.get(holdId))?.status).toBe('HELD');
  });
});
