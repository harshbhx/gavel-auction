import type { BidderId, MsgId, Cents, RoomSnapshot } from '@gavel/shared';
import {
  PROTOCOL_VERSION,
  type BidMsg,
  type BidSource,
  type ClientMessage,
  type ServerMessage,
} from '../wire';

export type PendingStatus = 'pending' | 'accepted' | 'rejected' | 'unknown';

export interface PendingBid {
  /** The message id (`mid`) the server echoes in bid_accepted and bid_rejected. */
  mid: MsgId;
  amount: Cents;
  source: BidSource;
  bidderId?: BidderId;
  status: PendingStatus;
  /** Set when the server rejected the bid. */
  code?: string;
}

export interface PendingSummary {
  /** A sent bid has no answer yet. */
  waiting: boolean;
  /** The latest bid was rejected; null when it was accepted, is still waiting, or none was sent. */
  rejection: { reason: string; mid: string } | null;
  /** The latest bid got no answer (or was never sent): the id to resend, else null. */
  unknownMid: MsgId | null;
  /** The amount that resending the unanswered bid would send, else null. */
  unknownAmount: Cents | null;
}

/** What the bidder screen shows about the bids this device sent, judged by the latest bid only. */
export function summarizePending(list: readonly PendingBid[]): PendingSummary {
  const latest = list.at(-1);
  return {
    waiting: list.some((b) => b.status === 'pending'),
    rejection:
      latest?.status === 'rejected' && latest.code !== undefined
        ? { reason: latest.code, mid: latest.mid }
        : null,
    unknownMid: latest?.status === 'unknown' ? latest.mid : null,
    unknownAmount: latest?.status === 'unknown' ? latest.amount : null,
  };
}

/** Finished (accepted or rejected) bids kept for display. Older ones are dropped. */
export const MAX_FINISHED_BIDS = 50;

export interface PendingBidDeps {
  /** A result of exactly `false` means the frame was not sent (socket not open). */
  send(msg: ClientMessage): unknown;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  newId(): MsgId;
  /** Defaults to 4000 ms (R-WEB-025). */
  unknownAfterMs?: number;
}

/**
 * Tracks bids the buyer sent. A bid is pending at once, then accepted or rejected by the
 * matching mid, or unknown after 4000 ms. A retry reuses the same mid, so a duplicate can never
 * be counted twice. Finished bids beyond MAX_FINISHED_BIDS are forgotten, oldest first.
 */
export class PendingBids {
  private readonly bids = new Map<MsgId, PendingBid>();
  private readonly timers = new Map<MsgId, unknown>();
  private readonly listeners = new Set<() => void>();
  private readonly deps: PendingBidDeps;

  constructor(deps: PendingBidDeps) {
    this.deps = deps;
  }

  /** `source` says where the bid came from: the bidder's own phone, the auctioneer's console, a voice parse. */
  submitBid(amount: Cents, source: BidSource, bidderId?: BidderId): MsgId {
    const mid = this.deps.newId();
    this.bids.set(mid, {
      mid,
      amount,
      source,
      ...(bidderId === undefined ? {} : { bidderId }),
      status: 'pending',
    });
    this.transmit(mid);
    return mid;
  }

  /** Sends an unknown bid again under its original id. Other statuses are left alone. */
  retry(mid: MsgId): boolean {
    const bid = this.bids.get(mid);
    if (bid === undefined || bid.status !== 'unknown') return false;
    this.bids.set(mid, { ...bid, status: 'pending' });
    this.transmit(mid);
    return true;
  }

  /** Feed every server message here. Only bid_accepted and bid_rejected matter. */
  handle(msg: ServerMessage): void {
    if (msg.t !== 'bid_accepted' && msg.t !== 'bid_rejected') return;
    const bid = this.bids.get(msg.mid);
    if (bid === undefined || bid.status === 'accepted' || bid.status === 'rejected') return;
    this.stopTimer(msg.mid);
    this.bids.set(
      msg.mid,
      msg.t === 'bid_accepted'
        ? { ...bid, status: 'accepted' }
        : { ...bid, status: 'rejected', code: msg.reason },
    );
    this.evictFinished();
    this.emit();
  }

  /**
   * After a (re)join, settles unanswered bids from the snapshot: when the server already holds
   * an accepted bid of this bidder at or above the amount, the answer was lost in the gap, so
   * the bid counts as accepted and the bidder is not asked to resend it.
   */
  reconcile(snapshot: RoomSnapshot): void {
    const high = snapshot.you?.highBid;
    if (high === undefined) return;
    let changed = false;
    for (const bid of [...this.bids.values()]) {
      if ((bid.status === 'unknown' || bid.status === 'pending') && bid.amount <= high) {
        this.stopTimer(bid.mid);
        this.bids.set(bid.mid, { ...bid, status: 'accepted' });
        changed = true;
      }
    }
    if (changed) {
      this.evictFinished();
      this.emit();
    }
  }

  get(mid: MsgId): PendingBid | undefined {
    return this.bids.get(mid);
  }

  list(): PendingBid[] {
    return [...this.bids.values()];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    for (const id of [...this.timers.keys()]) this.stopTimer(id);
    this.listeners.clear();
  }

  /** Keeps the map bounded: finished bids past the cap are dropped, oldest first. */
  private evictFinished(): void {
    const finished = [...this.bids.values()].filter(
      (b) => b.status === 'accepted' || b.status === 'rejected',
    );
    for (const old of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_BIDS))) {
      this.bids.delete(old.mid);
    }
  }

  private transmit(mid: MsgId): void {
    const bid = this.bids.get(mid);
    if (bid === undefined) return;
    const msg: BidMsg = {
      v: PROTOCOL_VERSION,
      t: 'bid',
      mid,
      amount: bid.amount,
      source: bid.source,
      ...(bid.bidderId === undefined ? {} : { bidderId: bid.bidderId }),
    };
    this.stopTimer(mid);
    this.timers.set(
      mid,
      this.deps.setTimer(() => {
        this.timers.delete(mid);
        const current = this.bids.get(mid);
        if (current?.status === 'pending') {
          this.bids.set(mid, { ...current, status: 'unknown' });
          this.emit();
        }
      }, this.deps.unknownAfterMs ?? 4000),
    );
    this.emit();
    // A transport that reports `false` did not put the frame on the wire: the bid is unknown at
    // once, so the bidder can resend it, instead of waiting out the timer.
    if (this.deps.send(msg) === false) {
      this.stopTimer(mid);
      const current = this.bids.get(mid);
      if (current?.status === 'pending') {
        this.bids.set(mid, { ...current, status: 'unknown' });
        this.emit();
      }
    }
  }

  private stopTimer(mid: MsgId): void {
    const handle = this.timers.get(mid);
    if (handle !== undefined) this.deps.clearTimer(handle);
    this.timers.delete(mid);
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}
