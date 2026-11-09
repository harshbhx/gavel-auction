import type { Cents, AuctionId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { Room, type RoomDeps } from '../src/room/room';
import { LedgerEngine } from '../src/runtime/ledger-engine';
import { MemoryStore } from '../src/store/memory-store';
import { ManualClock, SeqIds } from '@gavel/shared';
import { START, config } from './room-harness';

/** FIX-118: the cap is written to the log at creation and replay uses it, not the environment. */
describe('room replay uses the cap stored in the log', () => {
  const lotConfig = { ...config, reserve: 1000, ceilingPresets: [80000] } as typeof config;

  function deps(
    store: MemoryStore,
    clock: ManualClock,
    ids: SeqIds,
    cap: number,
  ): (id: AuctionId) => RoomDeps {
    return (id) => ({
      store,
      clock,
      ids,
      maxCeilingCents: cap,
      engine: (cfg, createdAt, logged) => new LedgerEngine(id, cfg, createdAt, logged ?? cap),
    });
  }

  it('keeps the same winner after the cap is lowered and the room restarts', async () => {
    const clock = new ManualClock(START);
    const ids = new SeqIds();
    const store = new MemoryStore(() => clock.now());
    const id = ids.mint<'AuctionId'>();
    const room = await Room.create(id, lotConfig, 'sub', deps(store, clock, ids, 100_000)(id));
    const a = ids.mint<'BidderId'>();
    await room.registerBidder({
      bidderId: a,
      name: 'Ada',
      ceiling: 80000 as Cents,
      holdRef: 'h1',
    });
    const first = (await store.readEvents(id, 1, 1))[0] as { maxCeilingCents?: number };
    expect(first.maxCeilingCents).toBe(100_000);

    // Restart with the cap lowered to 50000: replay still registers the 80000 ceiling.
    const reloaded = await Room.load(id, deps(store, clock, ids, 50_000)(id));
    // A bidder dropped by replay would be a no-op here: the roster must hold them.
    expect(await reloaded.revokeBidder(a, 'declined')).toBe('applied');
  });

  it('replays a legacy log without the field with the process cap', async () => {
    const clock = new ManualClock(START);
    const ids = new SeqIds();
    const store = new MemoryStore(() => clock.now());
    const id = ids.mint<'AuctionId'>();
    const noCap = { ...deps(store, clock, ids, 100_000)(id) } as RoomDeps;
    delete (noCap as { maxCeilingCents?: number }).maxCeilingCents;
    await Room.create(id, lotConfig, 'sub', noCap);
    const first = (await store.readEvents(id, 1, 1))[0] as Record<string, unknown>;
    expect('maxCeilingCents' in first).toBe(false);
    await expect(Room.load(id, deps(store, clock, ids, 100_000)(id))).resolves.toBeDefined();
  });
});
