import type { BidderId, MsgId, Cents } from '@gavel/shared';
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

/** Finished (accepted or rejected) bids kept for display. Older ones are dropped. */
export const MAX_FINISHED_BIDS = 50;

export interface PendingBidDeps {
  send(msg: ClientMessage): void;
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
    this.deps.send(msg);
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
