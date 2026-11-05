import type { Connection, Room } from '@gavel/server';
import type { BidMsg, BidderId, MsgId, Transport } from '@gavel/shared';

/** Milliseconds from any monotonic source; the real run injects performance.now. */
export type Now = () => number;

const BUCKET_UPPER_MS = [1, 2, 5, 10, 25, 50, 100, 250, 600, 1000, 5000] as const;

/** Latency samples with nearest rank percentiles and a bucket histogram. */
export class LatencyHistogram {
  private readonly samples: number[] = [];

  record(ms: number): void {
    this.samples.push(ms);
  }

  get count(): number {
    return this.samples.length;
  }

  /** Nearest rank percentile, 0 for an empty histogram. */
  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
    return sorted[Math.min(rank, sorted.length) - 1] ?? 0;
  }

  toJSON(): {
    count: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    buckets: Array<{ leMs: number | 'inf'; count: number }>;
  } {
    const buckets: Array<{ leMs: number | 'inf'; count: number }> = BUCKET_UPPER_MS.map((le) => ({
      leMs: le,
      count: this.samples.filter((s) => s <= le).length,
    }));
    buckets.push({ leMs: 'inf', count: this.samples.length });
    return {
      count: this.samples.length,
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
      max: this.percentile(100),
      buckets,
    };
  }
}

export interface Reply {
  type: 'bid_accepted' | 'bid_rejected';
  at: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** In-process stand-in for a WebSocket: it records every bid reply with its arrival time. */
export class TimedTransport implements Transport {
  /** Replies by message id, in order of arrival. */
  readonly replies = new Map<string, Reply[]>();
  /** Frames that were not a bid reply (broadcasts, errors). */
  other = 0;

  constructor(private readonly now: Now) {}

  send(text: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      this.other += 1;
      return;
    }
    if (
      isRecord(frame) &&
      (frame['t'] === 'bid_accepted' || frame['t'] === 'bid_rejected') &&
      typeof frame['mid'] === 'string'
    ) {
      const list = this.replies.get(frame['mid']) ?? [];
      list.push({ type: frame['t'], at: this.now() });
      this.replies.set(frame['mid'], list);
      return;
    }
    this.other += 1;
  }

  close(): void {
    // Nothing to release: there is no socket.
  }
}

export interface Sent {
  mid: string;
  amount: number;
  at: number;
}

/** One simulated bidder: sends bids into the room and keeps what it sent. */
export class SimulatedBidder {
  readonly sent: Sent[] = [];

  constructor(
    readonly id: BidderId,
    private readonly conn: Connection,
    readonly transport: TimedTransport,
    private readonly room: Room,
    private readonly mint: () => MsgId,
    private readonly now: Now,
  ) {}

  /** Submits a manual bid; resolves when the room has answered it. */
  async bid(amountCents: number): Promise<string> {
    const mid = this.mint();
    this.sent.push({ mid, amount: amountCents, at: this.now() });
    const msg: BidMsg = { v: 1, t: 'bid', mid, amount: amountCents, source: 'manual' };
    await this.room.submitBid(this.conn, msg);
    return mid;
  }
}

export interface Tally {
  sent: number;
  accepted: number;
  rejected: number;
  /** Bids that never got a reply. */
  lost: number;
  /** Bids that got more than one reply. */
  duplicate: number;
  latency: LatencyHistogram;
}

/** Joins what the bidders sent with what their transports received. */
export function tally(bidders: readonly SimulatedBidder[]): Tally {
  const t: Tally = {
    sent: 0,
    accepted: 0,
    rejected: 0,
    lost: 0,
    duplicate: 0,
    latency: new LatencyHistogram(),
  };
  for (const b of bidders) {
    for (const s of b.sent) {
      t.sent += 1;
      const replies = b.transport.replies.get(s.mid) ?? [];
      if (replies.length === 0) {
        t.lost += 1;
        continue;
      }
      if (replies.length > 1) t.duplicate += 1;
      const first = replies[0];
      if (first === undefined) continue;
      if (first.type === 'bid_accepted') t.accepted += 1;
      else t.rejected += 1;
      t.latency.record(Math.max(0, first.at - s.at));
    }
  }
  return t;
}
