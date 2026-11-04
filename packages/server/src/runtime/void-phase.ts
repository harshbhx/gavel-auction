import {
  PayPalError,
  buildRequestId,
  type HoldStore,
  type Journal,
  type PaymentsGateway,
} from '@gavel/payments';

/**
 * The void phase of a settlement is the payments package's `runVoidPhase`; this file only
 * holds what the service adds around it: reading a journal's release records and voiding the
 * holds the journal does not keep.
 */

const RELEASED_KINDS: ReadonlySet<string> = new Set(['already_voided', 'expired', 'not_found']);

/** Journal record values that mean the authorization is gone (VOID_FAILED and pending are not). */
const RELEASED_RECORDS: ReadonlySet<string> = new Set(['voided', 'released']);

/** True when this bidder's hold has a final release record (the payments phase keys by bidder). */
export function isReleased(journal: Journal, bidderId: string, holdId: string): boolean {
  const record = journal.voids[bidderId] ?? journal.voids[holdId];
  return record !== undefined && RELEASED_RECORDS.has(record);
}

export function voidRequestId(journal: Journal, holdId: string): string {
  return buildRequestId({
    auctionId: journal.auctionId,
    op: 'void',
    holdId,
    amountCents: 0,
    generation: 0,
  });
}

export interface SpareVoidDeps {
  gateway: PaymentsGateway;
  holds: HoldStore;
}

/**
 * Voids every live hold of the auction that the settlement does not keep: a second hold a
 * bidder approved after registering, a hold of a bidder who never registered, or, when the
 * settlement ends in review, every hold but the one with an unresolved capture. The request
 * id comes from the hold, so a repeat is applied once by PayPal. Returns how many voids are
 * still unconfirmed; a later run repeats them.
 */
export async function voidSpareHolds(
  deps: SpareVoidDeps,
  journal: Journal,
  keep: ReadonlySet<string>,
): Promise<number> {
  let open = 0;
  for (const hold of await deps.holds.listByAuction(journal.auctionId)) {
    if (hold.status !== 'HELD' || hold.authId === undefined || keep.has(hold.holdId)) continue;
    try {
      await deps.gateway.voidAuthorization(hold.authId, voidRequestId(journal, hold.holdId));
    } catch (e) {
      if (!(e instanceof PayPalError)) throw e;
      if (!RELEASED_KINDS.has(e.kind)) {
        open += 1;
        continue;
      }
    }
    await deps.holds.put({ ...hold, status: 'VOIDED' });
  }
  return open;
}
