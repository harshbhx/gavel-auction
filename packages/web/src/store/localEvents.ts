import type { BidSend, ClientMessage, ServerMessage } from '../wire';

export type PendingStatus = 'pending' | 'accepted' | 'rejected' | 'unknown';

export interface PendingBid {
  clientBidId: string;
  amountCents: number;
  status: PendingStatus;
  /** Set when the server rejected the bid. */
  code?: string;
}

export interface PendingBidDeps {
  paddle: number;
  send(msg: ClientMessage): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  newId(): string;
  /** Defaults to 4000 ms (R-WEB-025). */
  unknownAfterMs?: number;
}

/**
 * Tracks bids the buyer sent. A bid is pending at once, then accepted or rejected by the
 * matching clientBidId, or unknown after 4000 ms. A retry reuses the same clientBidId, so a
 * duplicate can never be counted twice.
 */
export class PendingBids {
  private readonly bids = new Map<string, PendingBid>();
  private readonly timers = new Map<string, unknown>();
  private readonly listeners = new Set<() => void>();
  private readonly deps: PendingBidDeps;

  constructor(deps: PendingBidDeps) {
    this.deps = deps;
  }

  submitBid(amountCents: number): string {
    const clientBidId = this.deps.newId();
    this.bids.set(clientBidId, { clientBidId, amountCents, status: 'pending' });
    this.transmit(clientBidId);
    return clientBidId;
  }

  /** Sends an unknown bid again under its original id. Other statuses are left alone. */
  retry(clientBidId: string): boolean {
    const bid = this.bids.get(clientBidId);
    if (bid === undefined || bid.status !== 'unknown') return false;
    this.bids.set(clientBidId, { ...bid, status: 'pending' });
    this.transmit(clientBidId);
    return true;
  }

  /** Feed every server message here. Only bid_accepted and bid_rejected matter. */
  handle(msg: ServerMessage): void {
    if (msg.t !== 'bid_accepted' && msg.t !== 'bid_rejected') return;
    const bid = this.bids.get(msg.clientBidId);
    if (bid === undefined || bid.status === 'accepted' || bid.status === 'rejected') return;
    this.stopTimer(msg.clientBidId);
    this.bids.set(
      msg.clientBidId,
      msg.t === 'bid_accepted'
        ? { ...bid, status: 'accepted' }
        : { ...bid, status: 'rejected', code: msg.code },
    );
    this.emit();
  }

  get(clientBidId: string): PendingBid | undefined {
    return this.bids.get(clientBidId);
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

  private transmit(clientBidId: string): void {
    const bid = this.bids.get(clientBidId);
    if (bid === undefined) return;
    const msg: BidSend = {
      t: 'bid',
      clientBidId,
      paddle: this.deps.paddle,
      amountCents: bid.amountCents,
      source: 'qr',
    };
    this.stopTimer(clientBidId);
    this.timers.set(
      clientBidId,
      this.deps.setTimer(() => {
        this.timers.delete(clientBidId);
        const current = this.bids.get(clientBidId);
        if (current?.status === 'pending') {
          this.bids.set(clientBidId, { ...current, status: 'unknown' });
          this.emit();
        }
      }, this.deps.unknownAfterMs ?? 4000),
    );
    this.emit();
    this.deps.send(msg);
  }

  private stopTimer(clientBidId: string): void {
    const handle = this.timers.get(clientBidId);
    if (handle !== undefined) this.deps.clearTimer(handle);
    this.timers.delete(clientBidId);
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}
