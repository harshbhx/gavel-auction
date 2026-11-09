import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HISTORY_KEY,
  MAX_ROOMS,
  clearHistory,
  hasHistory,
  readHistory,
  recordRoom,
  type HistoryStorage,
} from '../../src/home/history';

function memoryStorage(initial: Record<string, string> = {}): HistoryStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

const blocked: HistoryStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('browser history store', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('writes under one versioned key', () => {
    expect(recordRoom('room1', { role: 'bidder' }, 1000, storage)).toBe(true);
    expect([...storage.data.keys()]).toEqual([HISTORY_KEY]);
    expect(HISTORY_KEY).toBe('gavel.history.v1');
    expect(JSON.parse(storage.data.get(HISTORY_KEY) ?? '{}')).toMatchObject({ v: 1 });
  });

  it('creates a room, merges later updates and adds roles', () => {
    recordRoom('room1', { role: 'bidder', lotTitle: 'Signed print' }, 1000, storage);
    recordRoom(
      'room1',
      { role: 'auctioneer', lastPriceCents: 54000, result: 'won' },
      5000,
      storage,
    );
    const [room] = readHistory(storage);
    expect(room).toMatchObject({
      roomId: 'room1',
      roles: ['bidder', 'auctioneer'],
      createdAt: 1000,
      lastSeenAt: 5000,
      lotTitle: 'Signed print',
      lastPriceCents: 54000,
      result: 'won',
      receipt: false,
    });
  });

  it('keeps what it knew when a later patch leaves a field out', () => {
    recordRoom('room1', { paddle: 7, name: 'Asha', code: 'K7M2QX' }, 1, storage);
    recordRoom('room1', { result: 'lost' }, 2, storage);
    expect(readHistory(storage)[0]).toMatchObject({ paddle: 7, name: 'Asha', code: 'K7M2QX' });
  });

  it('keeps at most ten rooms and drops the oldest', () => {
    for (let i = 0; i < 14; i += 1) recordRoom(`room${i}`, {}, 1000 + i, storage);
    const rooms = readHistory(storage);
    expect(rooms).toHaveLength(MAX_ROOMS);
    expect(rooms[0]?.roomId).toBe('room13');
    expect(rooms.at(-1)?.roomId).toBe('room4');
    expect(rooms.some((r) => r.roomId === 'room0')).toBe(false);
  });

  it('moves a room that is seen again to the top', () => {
    recordRoom('a', {}, 1, storage);
    recordRoom('b', {}, 2, storage);
    recordRoom('a', {}, 3, storage);
    expect(readHistory(storage).map((r) => r.roomId)).toEqual(['a', 'b']);
  });

  it('reads nothing from a version it does not know', () => {
    storage.data.set(
      HISTORY_KEY,
      JSON.stringify({ v: 2, rooms: [{ roomId: 'x', lastSeenAt: 1 }] }),
    );
    expect(readHistory(storage)).toEqual([]);
    storage.data.set(HISTORY_KEY, JSON.stringify([{ roomId: 'x', lastSeenAt: 1 }]));
    expect(readHistory(storage)).toEqual([]);
  });

  it.each(['{not json', 'null', '"text"', '42', '{"v":1}', '{"v":1,"rooms":"no"}'])(
    'treats %s as an empty history and recovers on the next write',
    (raw) => {
      storage.data.set(HISTORY_KEY, raw);
      expect(readHistory(storage)).toEqual([]);
      expect(hasHistory(storage)).toBe(false);
      expect(recordRoom('room1', {}, 1, storage)).toBe(true);
      expect(readHistory(storage)).toHaveLength(1);
    },
  );

  it('skips damaged entries and keeps the good ones', () => {
    storage.data.set(
      HISTORY_KEY,
      JSON.stringify({
        v: 1,
        rooms: [
          { roomId: 'good', lastSeenAt: 5 },
          { roomId: '../evil', lastSeenAt: 6 },
          { roomId: 'nostamp' },
          'text',
          null,
        ],
      }),
    );
    expect(readHistory(storage).map((r) => r.roomId)).toEqual(['good']);
  });

  it('works without storage: nothing throws and nothing is remembered', () => {
    expect(readHistory(blocked)).toEqual([]);
    expect(recordRoom('room1', {}, 1, blocked)).toBe(false);
    expect(() => clearHistory(blocked)).not.toThrow();
    expect(hasHistory(blocked)).toBe(false);
    expect(readHistory(null)).toEqual([]);
    expect(recordRoom('room1', {}, 1, null)).toBe(false);
  });

  it('refuses a room id that is not a plain id', () => {
    expect(recordRoom('a/b', {}, 1, storage)).toBe(false);
    expect(recordRoom('', {}, 1, storage)).toBe(false);
    expect(readHistory(storage)).toEqual([]);
  });

  it('stores only the known summary fields: no token, secret, email or card data', () => {
    const sneaky = {
      role: 'bidder',
      lotTitle: 'Print',
      token: 'tok_live_123',
      auctioneerToken: 'a-token',
      email: 'someone@example.com',
      card: '4242424242424242',
    } as unknown as Parameters<typeof recordRoom>[1];
    recordRoom('room1', sneaky, 1, storage);
    const stored = JSON.parse(storage.data.get(HISTORY_KEY) ?? '{}') as {
      rooms: Record<string, unknown>[];
    };
    expect(Object.keys(stored.rooms[0] ?? {}).sort()).toEqual([
      'code',
      'createdAt',
      'expiresAt',
      'holdCents',
      'lastPriceCents',
      'lastSeenAt',
      'lotTitle',
      'name',
      'paddle',
      'receipt',
      'result',
      'roles',
      'roomId',
    ]);
    const raw = storage.data.get(HISTORY_KEY) ?? '';
    for (const secret of ['tok_live_123', 'a-token', 'someone@example.com', '4242']) {
      expect(raw).not.toContain(secret);
    }
  });

  it('writes a foreign field that was already in storage away on the next write', () => {
    storage.data.set(
      HISTORY_KEY,
      JSON.stringify({ v: 1, rooms: [{ roomId: 'r', lastSeenAt: 1, token: 'leaked' }] }),
    );
    recordRoom('r', {}, 2, storage);
    expect(storage.data.get(HISTORY_KEY)).not.toContain('leaked');
  });

  it('clears everything', () => {
    recordRoom('room1', {}, 1, storage);
    clearHistory(storage);
    expect(storage.data.size).toBe(0);
    expect(hasHistory(storage)).toBe(false);
  });

  it('uses localStorage by default and never sessionStorage', () => {
    recordRoom('room1', { role: 'watcher' }, 1);
    expect(window.localStorage.getItem(HISTORY_KEY)).not.toBeNull();
    expect(window.sessionStorage.getItem(HISTORY_KEY)).toBeNull();
    expect(readHistory()).toHaveLength(1);
  });

  it('clips a long lot title and a long name', () => {
    recordRoom('room1', { lotTitle: 'x'.repeat(500), name: 'n'.repeat(500) }, 1, storage);
    const [room] = readHistory(storage);
    expect(room?.lotTitle?.length).toBe(80);
    expect(room?.name?.length).toBe(40);
  });
});
