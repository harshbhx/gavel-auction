import { ManualClock, type AuctionId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { RoomRegistry } from '../src/room/registry';
import type { Room } from '../src/room/room';

const START = 1_789_000_000_000;
const MIN = 60_000;

interface FakeRoom {
  connectionCount: number;
  done: boolean;
  closed: boolean;
  close(): Promise<void>;
}

function fakeRoom(done: boolean): FakeRoom {
  const room: FakeRoom = {
    connectionCount: 0,
    done,
    closed: false,
    close: () => {
      room.closed = true;
      return Promise.resolve();
    },
  };
  return room;
}

const asRoom = (r: FakeRoom): Room => r as unknown as Room;
const id = (n: number): AuctionId => `A${String(n).padStart(25, '0')}` as AuctionId;

function setup(done: boolean, maxRooms = 20) {
  const clock = new ManualClock(START);
  const loads: AuctionId[] = [];
  const made = new Map<AuctionId, FakeRoom>();
  const registry = new RoomRegistry({
    clock,
    maxRooms,
    isDone: (r) => (r as unknown as FakeRoom).done,
    load: (a) => {
      loads.push(a);
      const room = fakeRoom(done);
      made.set(a, room);
      return Promise.resolve(asRoom(room));
    },
  });
  return { clock, registry, loads, made };
}

describe('T-RT-053 room registry', () => {
  it('loads lazily and once per auction', async () => {
    const s = setup(false);
    expect(s.loads).toEqual([]);
    const a = await s.registry.get(id(1));
    const b = await s.registry.get(id(1));
    expect(a).toBe(b);
    expect(s.loads).toHaveLength(1);
  });

  it('evicts a DONE room idle 15 min with no connections, then reloads', async () => {
    const s = setup(true);
    await s.registry.get(id(1));
    s.clock.advanceTo(START + 15 * MIN - 1);
    expect(await s.registry.sweep()).toEqual([]);
    s.clock.advanceTo(START + 15 * MIN);
    expect(await s.registry.sweep()).toEqual([id(1)]);
    expect(s.made.get(id(1))?.closed).toBe(true);
    expect(s.registry.size).toBe(0);
    await s.registry.get(id(1));
    expect(s.loads).toHaveLength(2);
  });

  it('keeps rooms that are connected, not done, or recently used', async () => {
    const s = setup(true);
    await s.registry.get(id(1));
    const live = s.made.get(id(1));
    if (live) live.connectionCount = 1;
    s.clock.advanceTo(START + 20 * MIN);
    expect(await s.registry.sweep()).toEqual([]);
    if (live) live.connectionCount = 0;
    s.registry.touch(id(1));
    expect(await s.registry.sweep()).toEqual([]);

    const open = setup(false);
    await open.registry.get(id(2));
    open.clock.advanceTo(START + 60 * MIN);
    expect(await open.registry.sweep()).toEqual([]);
  });

  it('refuses the 21st room with room_cap', async () => {
    const s = setup(false);
    for (let i = 1; i <= 20; i++) await s.registry.get(id(i));
    await expect(s.registry.get(id(21))).rejects.toMatchObject({ code: 'room_cap' });
    await expect(s.registry.get(id(1))).resolves.toBeDefined();
  });

  it('sweeps on the clock after start', async () => {
    const s = setup(true);
    await s.registry.get(id(1));
    s.registry.start();
    for (let i = 1; i <= 16; i++) {
      s.clock.advanceTo(START + i * MIN);
      for (let j = 0; j < 10; j++) await Promise.resolve();
    }
    expect(s.registry.size).toBe(0);
    s.registry.stop();
  });

  it('does not keep a failed load', async () => {
    const clock = new ManualClock(START);
    const registry = new RoomRegistry({
      clock,
      maxRooms: 1,
      isDone: () => false,
      load: () => Promise.reject(new Error('boom')),
    });
    await expect(registry.get(id(1))).rejects.toThrow('boom');
    await Promise.resolve();
    expect(registry.size).toBe(0);
  });
});
