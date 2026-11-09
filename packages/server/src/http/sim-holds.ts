import {
  DEFAULT_RAISE_POLICY,
  HoldError,
  raiseRefusal,
  sharedHoldQueue,
  type HoldStore,
  type HoldTruth,
  type PaymentsGateway,
  type RaisePolicy,
} from '@gavel/payments';
import { GavelError, type AuctionId, type BidderId, type Cents } from '@gavel/shared';

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

/** The record `createSimHoldSource` writes: both its id and its authorization are simulated. */
export function isSimHold(h: { holdId: string; authId?: string | undefined }): boolean {
  return h.holdId.startsWith('sim-hold-') && h.authId !== undefined && isSimAuth(h.authId);
}

/**
 * Drops the simulated holds of one auction from the hold store and returns how many went. Real
 * holds (any other id or authorization) are never matched, and neither is anything outside the
 * hold store: the ledger and audit trail are not touched. A store without `deleteByAuction`
 * drops nothing.
 */
export async function purgeSimHolds(holds: HoldStore, auctionId: string): Promise<number> {
  if (holds.deleteByAuction === undefined) return 0;
  return holds.deleteByAuction(auctionId, isSimHold);
}

/**
 * Writes a HELD hold with a simulated authorization. Returns the hold id. Like a real hold it is
 * written once: a repeat with the same ceiling returns the hold already there. A larger ceiling
 * for a bidder who already has one is a raise (D-0025): it gets its own hold, written once per
 * amount, and the room switches to it and voids the old one. A smaller or equal ceiling is
 * refused (`conflict`), so the stored ceiling never drifts from the one the room registered. The
 * read and the write run inside the per-hold queue.
 */
export function createSimHoldSource(
  holds: HoldStore,
  nowMs: () => number,
  raisePolicy: Partial<RaisePolicy> = {},
): (bidderId: BidderId, ceiling: Cents, auctionId: AuctionId) => Promise<string> {
  const policy: RaisePolicy = { ...DEFAULT_RAISE_POLICY, ...raisePolicy };
  const write = (
    holdId: string,
    auctionId: AuctionId,
    bidderId: BidderId,
    ceiling: Cents,
  ): Promise<void> =>
    holds.put({
      holdId,
      auctionId,
      bidderId,
      orderId: `sim-order-${bidderId}`,
      authId: simAuthId(bidderId, ceiling),
      ceilingCents: ceiling,
      status: 'HELD',
      createdAtMs: nowMs(),
    });
  return (bidderId, ceiling, auctionId) => {
    const holdId = `sim-hold-${bidderId}`;
    return sharedHoldQueue.run(holdId, async () => {
      const existing = await holds.get(holdId);
      if (existing === null) {
        await write(holdId, auctionId, bidderId, ceiling);
        return holdId;
      }
      if (
        existing.status === 'HELD' &&
        existing.ceilingCents === ceiling &&
        existing.auctionId === auctionId
      ) {
        return holdId;
      }
      if (existing.auctionId !== auctionId) {
        throw new GavelError('conflict', 'this bidder already has a hold; it can only be raised');
      }
      // A raise: one hold per amount, so a repeat of the same request finds it again.
      const raiseId = `${holdId}-${ceiling}`;
      return sharedHoldQueue.run(raiseId, async () => {
        const raised = await holds.get(raiseId);
        if (raised !== null) {
          if (raised.status === 'HELD' && raised.ceilingCents === ceiling) return raiseId;
          throw new GavelError('conflict', 'this bidder already had a hold of that amount');
        }
        // The bidder's holds in this room: the first one and one per raise so far (#2397).
        const mine = (await holds.listByAuction(auctionId)).filter(
          (h) => h.bidderId === bidderId && isSimHold(h),
        );
        const current = mine.reduce((m, h) => Math.max(m, h.ceilingCents), existing.ceilingCents);
        if (ceiling <= current) {
          throw new GavelError('conflict', 'this bidder already has a hold; it can only be raised');
        }
        const refusal = raiseRefusal(
          { currentCents: current, nextCents: ceiling, done: Math.max(0, mine.length - 1) },
          policy,
        );
        if (refusal === 'raise_limit_reached') {
          throw new HoldError(refusal, 'this bidder has used all raises of the limit');
        }
        if (refusal === 'raise_too_small') {
          throw new HoldError(refusal, 'the raise is below the minimum step');
        }
        await write(raiseId, auctionId, bidderId, ceiling);
        return raiseId;
      });
    });
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
          // Like PayPal after our final capture: CAPTURED, with the rest of the authorization closed
          // by it. PARTIALLY_CAPTURED made the saga read a winner below the ceiling as a mismatch
          // and send every simulated settlement with bids to review (SRV-39).
          status: 'CAPTURED',
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
