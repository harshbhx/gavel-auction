import type { HoldStore } from '@gavel/payments';
import type { AuctionId, BidderId, Cents } from '@gavel/shared';

/**
 * Hold source for scripted demo bidders. It writes an already-approved hold straight into the
 * hold store, so no PayPal call happens. Only the demo mount uses it, and only with the fake
 * payments adapter; the demo flag is refused under production config.
 */
export function createDemoHoldSource(
  holds: HoldStore,
  nowMs: () => number,
): (bidderId: BidderId, ceiling: Cents, auctionId: AuctionId) => Promise<string> {
  return async (bidderId, ceiling, auctionId) => {
    const holdId = `demo-hold-${bidderId}`;
    await holds.put({
      holdId,
      auctionId,
      bidderId,
      orderId: `demo-order-${bidderId}`,
      authId: `demo-auth-${bidderId}`,
      ceilingCents: ceiling,
      status: 'HELD',
      createdAtMs: nowMs(),
    });
    return holdId;
  };
}
