import { describe, expect, it } from 'vitest';
import { FakeClock, FakePayPalCore } from '../../src/fake/core.js';
import { FakeGateway } from '../../src/fake/gateway.js';
import { HoldService } from '../../src/holds/service.js';
import { MemoryHoldStore } from '../../src/stores/memory.js';

const BASE = 'https://pay.example.test/approve';

function rig() {
  const clock = new FakeClock(1_800_000_000_000);
  const core = new FakePayPalCore({ clock, approveBaseUrl: BASE });
  const service = new HoldService({
    gateway: new FakeGateway(core),
    holds: new MemoryHoldStore(),
    audit: { append: async () => undefined },
    clock: { nowMs: () => clock.nowMs() },
    maxCeilingCents: 25000,
  });
  return { service };
}

const input = { auctionId: 'a1', bidderId: 'b1', ceilingCents: 15000, presetsCents: [15000] };

describe('createHoldOrder approval link (issue 1778)', () => {
  it('returns the approval link PayPal gave for the new order', async () => {
    const r = rig();
    const created = await r.service.createHoldOrder(input);
    expect(created.approveUrl).toBeDefined();
    expect(created.approveUrl?.startsWith(BASE)).toBe(true);
    expect(created.approveUrl).toContain(created.orderId);
  });

  it('returns the same link when a repeat call reuses the pending order', async () => {
    const r = rig();
    const first = await r.service.createHoldOrder(input);
    const second = await r.service.createHoldOrder(input);
    expect(second).toEqual(first);
  });
});
