import { remainderKey, settlementUpdateFor, type HoldStatus, type Journal } from '@gavel/payments';
import type { Cents, OwnHold, RemainderState } from '@gavel/shared';

/** One bidder's hold as the settlement shows it to that bidder; the room adds the bidder id. */
export type OwnHoldDetail = Omit<OwnHold, 'bidderId'>;

export interface OwnHolds {
  /** Each bidder's own hold, keyed by bidder id. */
  holds: Record<string, OwnHoldDetail>;
  /** The bidder whose hold was captured, once there is one. */
  winnerId?: string;
}

/** Journal `voids` values that mean PayPal let go of the winner's remainder (void phase). */
const REMAINDER_RELEASED: ReadonlySet<string> = new Set(['remainder_released', 'remainder_voided']);
const REMAINDER_LEFT = 'remainder_unreleased';

/** Statuses whose whole hold no longer reserves money. */
const WHOLE_HOLD_RELEASED: ReadonlySet<HoldStatus> = new Set(['VOIDED', 'EXPIRED']);

function remainderOf(journal: Journal, bidderId: string, leftCents: number): RemainderState {
  if (leftCents <= 0) return 'none';
  const record = journal.voids[remainderKey(bidderId)];
  if (record !== undefined && REMAINDER_RELEASED.has(record)) return 'released';
  if (record === REMAINDER_LEFT) return 'unreleased';
  return 'pending';
}

/**
 * Per-bidder hold detail for the `settlement_update` frames (issue 712). The statuses and the
 * capture come from the settlement payload the payments emitter publishes for this journal
 * (`settlementUpdateFor`, HRD-52), so the frames and the published payload agree; the hold
 * amounts and the remainder record come from the same journal. Integer cents throughout.
 */
export function ownHoldsOf(journal: Journal, tsMs: number): OwnHolds {
  const payload = settlementUpdateFor(journal, tsMs);
  const capture = payload.capture;
  const holds: Record<string, OwnHoldDetail> = {};
  for (const h of payload.holds) {
    const ref = journal.holds[h.bidderId];
    if (ref === undefined) continue;
    const captured =
      h.status === 'CAPTURED' && capture !== null && capture.bidderId === h.bidderId
        ? capture.amountCents
        : 0;
    const left = Math.max(0, ref.ceilingCents - captured);
    const remainder = h.status === 'CAPTURED' ? remainderOf(journal, h.bidderId, left) : 'none';
    let released = 0;
    if (WHOLE_HOLD_RELEASED.has(h.status)) released = ref.ceilingCents;
    else if (remainder === 'released') released = left;
    holds[h.bidderId] = {
      idSuffix: h.holdId.slice(-6),
      status: h.status,
      ceilingCents: ref.ceilingCents as Cents,
      capturedCents: captured,
      releasedCents: released,
      remainder,
    };
  }
  return { holds, ...(capture !== null ? { winnerId: capture.bidderId } : {}) };
}
