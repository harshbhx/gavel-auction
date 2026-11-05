import type { AuditPayload, RoomEvent } from '@gavel/shared';

export type ConfirmOutcome = Extract<RoomEvent, { type: 'confirm_resolved' }>['outcome'];

/** Audit reason text per outcome; an accepted answer has none. */
export const CONFIRM_REASON: Readonly<Record<ConfirmOutcome, string>> = {
  accepted: 'confirmed by bidder',
  rejected: 'rejected by bidder',
  expired: 'confirmation timed out',
  superseded: 'replaced by a newer bid',
};

export function resolvedEvent(
  base: Pick<RoomEvent, 'auctionId' | 'seq' | 'ts'>,
  confirmId: string,
  outcome: ConfirmOutcome,
  audit: AuditPayload,
): Extract<RoomEvent, { type: 'confirm_resolved' }> {
  return {
    type: 'confirm_resolved',
    auctionId: base.auctionId,
    seq: base.seq,
    ts: base.ts,
    confirmId,
    outcome,
    audit,
  };
}

/** Outcomes that end in no bid, so the bidder is told their bid was not placed. */
export function endsWithoutBid(outcome: ConfirmOutcome): boolean {
  return outcome === 'rejected' || outcome === 'expired';
}
