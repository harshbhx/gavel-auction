import type { HoldStore, HoldTruth, PaymentsGateway } from '@gavel/payments';
import type { AuctionId, BidderId, Cents } from '@gavel/shared';

/**
 * Simulated holds for judge rooms: a hold that is written already approved, with no PayPal call,
 * so a judge can test the whole path without a PayPal login. Its authorization id carries a
 * prefix and the held amount; `withSimulatedHolds` answers the settlement for those ids itself
 * and passes every other id to the real gateway, so a normal hold never reaches this code.
 */
export const SIM_AUTH_PREFIX = 'sim-auth-';

const simAuthId = (bidderId: string, ceilingCents: number): string =>
  `${SIM_AUTH_PREFIX}${bidderId}-${ceilingCents}`;

/** True for an authorization id made by `createSimHoldSource`. */
export function isSimAuth(authId: string): boolean {
  return authId.startsWith(SIM_AUTH_PREFIX);
}

function simAmount(authId: string): number {
  const n = Number(authId.slice(authId.lastIndexOf('-') + 1));
  return Number.isFinite(n) ? n : 0;
}

/** Writes a HELD hold with a simulated authorization. Returns the hold id. */
export function createSimHoldSource(
  holds: HoldStore,
  nowMs: () => number,
): (bidderId: BidderId, ceiling: Cents, auctionId: AuctionId) => Promise<string> {
  return async (bidderId, ceiling, auctionId) => {
    const holdId = `sim-hold-${bidderId}`;
    await holds.put({
      holdId,
      auctionId,
      bidderId,
      orderId: `sim-order-${bidderId}`,
      authId: simAuthId(bidderId, ceiling),
      ceilingCents: ceiling,
      status: 'HELD',
      createdAtMs: nowMs(),
    });
    return holdId;
  };
}

/**
 * The gateway the settlement uses, with simulated authorizations answered here: capture takes the
 * amount, void and reauthorize succeed, and the truth read reports what this process did with the
 * id (a restart forgets it and reads as still held, which the settlement handles as a retry).
 */
export function withSimulatedHolds(gateway: PaymentsGateway, nowMs: () => number): PaymentsGateway {
  const captured = new Map<string, number>();
  const voided = new Set<string>();
  return {
    createOrder: (i) => gateway.createOrder(i),
    getOrder: (id) => gateway.getOrder(id),
    authorizeOrder: (id, requestId) => gateway.authorizeOrder(id, requestId),
    getHoldTruth(h): Promise<HoldTruth> {
      if (!isSimAuth(h.authId)) return gateway.getHoldTruth(h);
      const amount = simAmount(h.authId);
      const taken = captured.get(h.authId);
      const base = {
        holdId: h.holdId,
        authId: h.authId,
        amountCents: amount,
        observedAtMs: nowMs(),
      };
      if (taken !== undefined) {
        return Promise.resolve({
          ...base,
          status: taken >= amount ? 'CAPTURED' : 'PARTIALLY_CAPTURED',
          capturedCents: taken,
          captures: [{ captureId: `sim-cap-${h.authId}`, amountCents: taken, final: true }],
        });
      }
      return Promise.resolve({
        ...base,
        status: voided.has(h.authId) ? 'VOIDED' : 'PENDING',
        capturedCents: 0,
        captures: [],
      });
    },
    capture(authId, i) {
      if (!isSimAuth(authId)) return gateway.capture(authId, i);
      captured.set(authId, i.amountCents);
      return Promise.resolve({ captureId: `sim-cap-${authId}`, amountCents: i.amountCents });
    },
    voidAuthorization(authId, requestId) {
      if (!isSimAuth(authId)) return gateway.voidAuthorization(authId, requestId);
      voided.add(authId);
      return Promise.resolve();
    },
    reauthorize(authId, i) {
      if (!isSimAuth(authId)) return gateway.reauthorize(authId, i);
      return Promise.resolve({ authId, amountCents: i.amountCents });
    },
  };
}
