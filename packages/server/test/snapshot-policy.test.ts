import { SeqIds, type AuctionId, type ConnId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { MemoryTransport } from '../src/room/memory-transport';
import { Room } from '../src/room/room';
import { SnapshotPolicy, snapshotDue } from '../src/room/snapshot-policy';
import { MemoryStore } from '../src/store/memory-store';
import { FlakyStore } from '../src/testing/flaky-store';
import { setup } from './room-harness';

const A = new SeqIds().mint<'AuctionId'>() as AuctionId;

describe('snapshot policy (R-RT-095)', () => {
  it('is due at every 100 events and on a state change, not otherwise', () => {
    expect(snapshotDue({ seq: 99, lastSavedSeq: 0, stateChanged: false })).toBe(false);
    expect(snapshotDue({ seq: 100, lastSavedSeq: 0, stateChanged: false })).toBe(true);
    expect(snapshotDue({ seq: 199, lastSavedSeq: 100, stateChanged: false })).toBe(false);
    expect(snapshotDue({ seq: 200, lastSavedSeq: 100, stateChanged: false })).toBe(true);
    expect(snapshotDue({ seq: 7, lastSavedSeq: 0, stateChanged: true })).toBe(true);
    expect(snapshotDue({ seq: 7, lastSavedSeq: 7, stateChanged: true })).toBe(false);
  });

  it('saves at events 100 and 200', async () => {
    const policy = new SnapshotPolicy(new MemoryStore(), A);
    const saved: number[] = [];
    for (let seq = 1; seq <= 205; seq += 1) {
      if (await policy.afterCommit(seq, false, () => ({ seq }))) saved.push(seq);
    }
    expect(saved).toEqual([100, 200]);
  });

  it('saves at a state change and restarts the 100-event count from there', async () => {
    const store = new MemoryStore();
    const policy = new SnapshotPolicy(store, A);
    const saved: number[] = [];
    for (let seq = 1; seq <= 205; seq += 1) {
      if (await policy.afterCommit(seq, seq === 150, () => ({ seq }))) saved.push(seq);
    }
    expect(saved).toEqual([100, 150]);
    expect(await store.loadSnapshot(A)).toEqual({ seq: 150, state: { seq: 150 } });
  });

  it('never fails the command when the save fails', async () => {
    const errors: unknown[] = [];
    const store = new FlakyStore(new MemoryStore());
    store.saveSnapshot = () => Promise.reject(new Error('disk full'));
    const policy = new SnapshotPolicy(store, A, 0, (e) => errors.push(e));
    await expect(policy.afterCommit(100, false, () => ({}))).resolves.toBe(false);
    expect(errors).toHaveLength(1);
  });

  it('recovers the same room with the snapshot deleted', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    await t.room.submitBid(c1.conn, t.bid(10000));
    const last = await t.store.lastSeq(t.auctionId);
    await new SnapshotPolicy(t.store, t.auctionId).afterCommit(last, true, () => ({
      price: 10000,
    }));
    expect(await t.store.loadSnapshot(t.auctionId)).not.toBeNull();
    // A store holding the same log but no snapshot.
    const bare = new MemoryStore();
    await bare.appendEvents(t.auctionId, 0, await t.store.readEvents(t.auctionId, 1, 1000));
    expect(await bare.loadSnapshot(t.auctionId)).toBeNull();
    const reloaded = await Room.load(t.auctionId, { ...t.deps, store: bare });
    const original = await t.connect('screen');
    const transport = new MemoryTransport();
    await reloaded.attach({ id: 'reload-conn' as ConnId, role: 'screen', sub: 's', transport });
    expect(transport.messages('state').at(-1)?.snapshot).toEqual(
      original.transport.messages('state').at(-1)?.snapshot,
    );
  });
});

describe('the room saves snapshots through the policy (#1729)', () => {
  it('saves a snapshot once 100 events are committed and not before', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    let price = 10000;
    const next = async (): Promise<void> => {
      await t.room.submitBid(c1.conn, t.bid(price));
      price += 500;
      await t.room.submitBid(c2.conn, t.bid(price));
      price += 500;
    };
    while (t.room.lastSeq < 90) await next();
    expect(await t.store.loadSnapshot(t.auctionId)).toBeNull();
    while (t.room.lastSeq < 100) await next();
    const snap = await t.store.loadSnapshot(t.auctionId);
    expect(snap?.seq).toBeGreaterThanOrEqual(100);
  });
});
