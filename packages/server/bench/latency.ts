import { performance } from 'node:perf_hooks';
import {
  ManualClock,
  SeqIds,
  type AuctionConfig,
  type BidderId,
  type Cents,
  type ConnId,
  type MsgId,
} from '@gavel/shared';
import { MemoryTransport } from '../src/room/memory-transport';
import { Room, type Connection } from '../src/room/room';
import { LedgerEngine } from '../src/runtime/ledger-engine';
import { MemoryStore } from '../src/store/memory-store';

/** R-RT-150 targets, server side, MemoryStore, local. */
export const TARGET_P95_MS = 50;
export const TARGET_SNAPSHOT_MS = 200;

const START = 1_789_000_000_000;

export interface LatencyOptions {
  /** Bids to time for the accept-to-broadcast figure. Default 5000. */
  bids?: number;
  /** Connections that receive every broadcast. Default 50. */
  listeners?: number;
  /** Bids in the room when the snapshot is timed. Default 500. */
  snapshotBids?: number;
}

export interface LatencyResult {
  bids: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  snapshotBids: number;
  snapshotMs: number;
}

const config = {
  mode: 'english',
  currency: 'USD',
  reserve: 100,
  minIncrement: 1,
  endTs: START + 24 * 3_600_000,
  softCloseWindowMs: 1000,
  softCloseExtensionMs: 1000,
  maxExtensions: 1,
  ceilingPresets: [50000],
  confirmConfidenceThreshold: 0.85,
} as unknown as AuctionConfig;

const CEILING = 100_000 as Cents;

async function build(listeners: number) {
  const clock = new ManualClock(START);
  const ids = new SeqIds();
  const store = new MemoryStore(() => clock.now());
  const auctionId = ids.mint<'AuctionId'>();
  const room = await Room.create(auctionId, config, 'auctioneer-sub', {
    store,
    clock,
    ids,
    engine: (c, createdAt) => new LedgerEngine(auctionId, c, createdAt),
  });
  const connect = async (role: Connection['role'], bidderId?: BidderId): Promise<Connection> => {
    const conn: Connection = {
      id: ids.mint<'ConnId'>() as ConnId,
      role,
      sub: bidderId ?? `${role}-sub`,
      transport: new MemoryTransport(),
      ...(bidderId ? { bidderId } : {}),
    };
    await room.attach(conn);
    return conn;
  };
  const bidders: BidderId[] = [];
  for (let i = 0; i < 2; i += 1) {
    const bidderId = ids.mint<'BidderId'>() as BidderId;
    bidders.push(bidderId);
    await room.registerBidder({ bidderId, name: `B${i}`, ceiling: CEILING, holdRef: `h${i}` });
  }
  const conns = [await connect('bidder', bidders[0]), await connect('bidder', bidders[1])];
  for (let i = 0; i < listeners; i += 1) await connect('screen');
  let n = 0;
  const bid = async (): Promise<void> => {
    const who = conns[n % 2];
    if (!who) throw new Error('no bidder');
    await room.submitBid(who, {
      v: 1,
      t: 'bid',
      mid: ids.mint<'MsgId'>() as MsgId,
      amount: config.reserve + n * config.minIncrement,
      source: 'qr',
    });
    n += 1;
  };
  return { room, connect, bid };
}

function percentile(sorted: number[], p: number): number {
  const at = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, at)] ?? 0;
}

export async function runLatencyBench(opts: LatencyOptions = {}): Promise<LatencyResult> {
  const bids = opts.bids ?? 5000;
  const snapshotBids = opts.snapshotBids ?? 500;
  const run = await build(opts.listeners ?? 50);
  const samples: number[] = [];
  for (let i = 0; i < bids; i += 1) {
    // submitBid resolves after the room has written the log and sent every frame.
    const t0 = performance.now();
    await run.bid();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);

  const snap = await build(0);
  for (let i = 0; i < snapshotBids; i += 1) await snap.bid();
  const s0 = performance.now();
  await snap.connect('screen');
  const snapshotMs = performance.now() - s0;

  return {
    bids,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    maxMs: samples[samples.length - 1] ?? 0,
    snapshotBids,
    snapshotMs,
  };
}

async function main(): Promise<void> {
  const r = await runLatencyBench();
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  if (r.p95Ms >= TARGET_P95_MS || r.snapshotMs >= TARGET_SNAPSHOT_MS) {
    process.stderr.write('latency target missed (R-RT-150)\n');
    process.exitCode = 1;
  }
}

if (process.argv.some((a) => a.replace(/\\/g, '/').endsWith('bench/latency.ts'))) {
  void main();
}
