import { ManualClock, SeqIds, type BidderId, type Cents, type ConnId } from '@gavel/shared';
import { MemoryTransport } from '../src/room/memory-transport';
import { Room, type Connection, type RoomDeps } from '../src/room/room';
import { MemoryStore } from '../src/store/memory-store';
import { SCENARIO_CONFIG, ScenarioEngine, START_MS } from '../src/testing/scenario-runner';

export interface RecoverResult {
  events: number;
  /** Time to rebuild the room from its log, measured with the process timer. */
  elapsedMs: number;
  /** Heap growth over the rebuild while the rebuilt room is still held. */
  heapDeltaBytes: number;
  lastSeq: number;
  price: number | null;
}

const collect = (): void => {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc === 'function') gc();
};

/** Builds a room with `events` log entries (R-RT-153), then recovers it from the log alone. */
export async function runRecover(events = 5000): Promise<RecoverResult> {
  const clock = new ManualClock(START_MS);
  const ids = new SeqIds();
  const store = new MemoryStore(() => clock.now());
  const deps: RoomDeps = {
    store,
    clock,
    ids,
    engine: (cfg) => new ScenarioEngine(cfg),
  };
  const auctionId = ids.mint<'AuctionId'>();
  const room = await Room.create(auctionId, SCENARIO_CONFIG, 'auctioneer-sub', deps);
  const conns: Connection[] = [];
  for (let i = 0; i < 2; i += 1) {
    const bidderId = ids.mint<'BidderId'>() as BidderId;
    await room.registerBidder({
      bidderId,
      name: `Bidder ${i}`,
      ceiling: 100_000_000 as Cents,
      holdRef: `hold-${i}`,
    });
    conns.push({
      id: ids.mint<'ConnId'>() as ConnId,
      role: 'bidder',
      sub: `sub-${i}`,
      bidderId,
      transport: new MemoryTransport(),
    });
  }
  // The log so far holds the created event and two registrations; every bid adds one event.
  const bids = events - 3;
  for (let n = 1; n <= bids; n += 1) {
    const conn = conns[n % 2];
    if (!conn) continue;
    await room.submitBid(conn, {
      v: 1,
      t: 'bid',
      mid: ids.mint<'MsgId'>(),
      amount: 10_000 + 500 * n,
      source: 'qr',
    });
  }
  room.stop();

  collect();
  const before = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const rebuilt = await Room.load(auctionId, deps);
  const elapsedMs = performance.now() - t0;
  collect();
  const heapDeltaBytes = process.memoryUsage().heapUsed - before;
  const result: RecoverResult = {
    events: await store.lastSeq(auctionId),
    elapsedMs,
    heapDeltaBytes,
    lastSeq: rebuilt.lastSeq,
    price: rebuilt.activeEngine?.view().price ?? null,
  };
  rebuilt.stop();
  return result;
}
