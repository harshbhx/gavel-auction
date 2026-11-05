import type {
  AuditPayload,
  BidMsg,
  BidderId,
  BidId,
  CancelTimer,
  Cents,
  EpochMs,
  MsgId,
  RoomEvent,
} from '@gavel/shared';

/** How long a held voice bid waits for its bidder (R-RT-045). */
export const CONFIRM_TTL_MS = 15_000;

/** A voice bid held back until its bidder answers; the engine has not seen it. */
export interface PendingConfirm {
  readonly confirmId: string;
  readonly bidderId: BidderId;
  readonly mid: MsgId;
  readonly amount: Cents;
  readonly transcript?: string;
  readonly confidence?: number;
  readonly expiresAt: EpochMs;
  cancel?: CancelTimer;
}

/**
 * True when a bid must be confirmed before the engine may see it: a voice bid whose
 * confidence is below the threshold, or one the parser flagged as ambiguous (R-RT-045).
 */
export function needsConfirm(msg: BidMsg, threshold: number): boolean {
  if (msg.source !== 'voice') return false;
  if (msg.ambiguous === true) return true;
  return msg.confidence !== undefined && msg.confidence < threshold;
}

/** The held bids of one room, at most one per bidder. */
export class ConfirmBook {
  private readonly byId = new Map<string, PendingConfirm>();
  private readonly byBidder = new Map<BidderId, string>();

  get(confirmId: string): PendingConfirm | undefined {
    return this.byId.get(confirmId);
  }

  forBidder(bidderId: BidderId): PendingConfirm | undefined {
    const id = this.byBidder.get(bidderId);
    return id === undefined ? undefined : this.byId.get(id);
  }

  add(p: PendingConfirm): void {
    this.byId.set(p.confirmId, p);
    this.byBidder.set(p.bidderId, p.confirmId);
  }

  /** Forget a held bid and cancel its expiry timer. */
  drop(confirmId: string): void {
    const p = this.byId.get(confirmId);
    if (!p) return;
    p.cancel?.();
    this.byId.delete(confirmId);
    if (this.byBidder.get(p.bidderId) === confirmId) this.byBidder.delete(p.bidderId);
  }

  clear(): void {
    for (const p of this.byId.values()) p.cancel?.();
    this.byId.clear();
    this.byBidder.clear();
  }

  get size(): number {
    return this.byId.size;
  }
}

/** The audit row of a confirm event; it never names a bid that was not placed. */
export function confirmAudit(
  p: PendingConfirm,
  bidId: BidId,
  outcome: AuditPayload['outcome'],
  reason: string,
  serverTs: EpochMs,
  seq: number,
): AuditPayload {
  const audit: AuditPayload = {
    bidId,
    bidderId: p.bidderId,
    source: 'voice',
    parsedAmount: p.amount,
    outcome,
    reason,
    serverTs,
    seq,
  };
  if (p.transcript !== undefined) audit.transcript = p.transcript;
  if (p.confidence !== undefined) audit.confidence = p.confidence;
  if (outcome === 'accepted') audit.confirmed = true;
  return audit;
}

export function requestedEvent(
  auctionId: RoomEvent['auctionId'],
  p: PendingConfirm,
  audit: AuditPayload,
  seq: number,
  ts: EpochMs,
): Extract<RoomEvent, { type: 'confirm_requested' }> {
  return {
    type: 'confirm_requested',
    auctionId,
    seq,
    ts,
    confirmId: p.confirmId,
    bidderId: p.bidderId,
    mid: p.mid,
    amount: p.amount,
    expiresAt: p.expiresAt,
    audit,
  };
}
