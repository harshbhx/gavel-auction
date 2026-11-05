import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type BidderId,
  type Cents,
  type ConnId,
  type Transport,
} from '@gavel/shared';
import { Room, type Connection, type RoomDeps } from '../src/room/room';
import { MemoryStore } from '../src/store/memory-store';
import { SCENARIO_CONFIG, ScenarioEngine, START_MS } from '../src/testing/scenario-runner';

export interface LoadOptions {
  bidders?: number;
  bidsPerSecond?: number;
  seconds?: number;
  seed?: number;
}

export interface LoadResult {
  bids: number;
  frames: number;
  /** Frames whose seq was lower than the previous seq on the same connection. */
  seqInversions: number;
  /** Most commands waiting on the room mailbox at once. */
  maxMailboxDepth: number;
  /** Most commands the room ran at once; must be 1. */
  maxConcurrent: number;
}

/** Small seeded generator so a run is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Counts frames and seq inversions as they arrive instead of keeping them. */
class CountingTransport implements Transport {
  frames = 0;
  inversions = 0;
  private last = 0;

  send(text: string): void {
    this.frames += 1;
    const msg = JSON.parse(text) as { t?: unknown; seq?: unknown };
    // The snapshot frame carries the current seq and may repeat it; every other frame is ordered.
    if (msg.t === 'state' || typeof msg.seq !== 'number') return;
    if (msg.seq < this.last) this.inversions += 1;
    this.last = msg.seq;
  }

  close(): void {
    return undefined;
  }
}

/**
 * Scripted bidders against one room on a ManualClock (R-RT-152). Each virtual second the
 * bids of that second are submitted together, so the mailbox really queues; no wall clock.
 */
export async function runLoad(opts: LoadOptions = {}): Promise<LoadResult> {
  const nBidders = opts.bidders ?? 100;
  const perSecond = opts.bidsPerSecond ?? 10;
  const seconds = opts.seconds ?? 60;
  const rand = mulberry32(opts.seed ?? 1);
  const clock = new ManualClock(START_MS);
  const ids = new SeqIds();
  const deps: RoomDeps = {
    store: new MemoryStore(() => clock.now()),
    clock,
    ids,
    engine: (cfg: AuctionConfig) => new ScenarioEngine(cfg),
  };
  const room = await Room.create(ids.mint<'AuctionId'>(), SCENARIO_CONFIG, 'auctioneer-sub', deps);
  const conns: Connection[] = [];
  const transports: CountingTransport[] = [];
  for (let i = 0; i < nBidders; i += 1) {
    const bidderId = ids.mint<'BidderId'>() as BidderId;
    await room.registerBidder({
      bidderId,
      name: `Bidder ${i}`,
      ceiling: 10_000_000 as Cents,
      holdRef: `hold-${i}`,
    });
    const transport = new CountingTransport();
    const conn: Connection = {
      id: ids.mint<'ConnId'>() as ConnId,
      role: 'bidder',
      sub: `sub-${i}`,
      bidderId,
      transport,
    };
    await room.attach(conn);
    conns.push(conn);
    transports.push(transport);
  }

  let bids = 0;
  let maxDepth = 0;
  for (let s = 0; s < seconds; s += 1) {
    clock.advance(1000);
    const pending: Array<Promise<void>> = [];
    let depth = 0;
    for (let k = 0; k < perSecond; k += 1) {
      const conn = conns[Math.floor(rand() * conns.length)];
      if (!conn) continue;
      bids += 1;
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      pending.push(
        room
          .submitBid(conn, {
            v: 1,
            t: 'bid',
            mid: ids.mint<'MsgId'>(),
            amount: 10_000 + 500 * bids,
            source: 'qr',
          })
          .then(() => {
            depth -= 1;
          }),
      );
    }
    await Promise.all(pending);
  }

  return {
    bids,
    frames: transports.reduce((n, t) => n + t.frames, 0),
    seqInversions: transports.reduce((n, t) => n + t.inversions, 0),
    maxMailboxDepth: maxDepth,
    maxConcurrent: room.maxConcurrent,
  };
}
