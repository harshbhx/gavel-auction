import { describe, expect, it } from 'vitest';
import { clearSession, loadSession, saveSession, type StorageLike } from '../../src/net/session';

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const blocked: StorageLike = {
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

describe('session storage (R-WEB-029)', () => {
  it('keeps the token and bidder per auction, so a reload stays a bidder', () => {
    const store = memory();
    expect(saveSession('a1', { token: 'tok-1', bidderId: 'b1' }, store)).toBe(true);
    expect(saveSession('a2', { token: 'tok-2' }, store)).toBe(true);
    expect(loadSession('a1', store)).toEqual({ token: 'tok-1', bidderId: 'b1' });
    expect(loadSession('a2', store)).toEqual({ token: 'tok-2' });
    expect(loadSession('a3', store)).toBeNull();
  });

  it('forgets one auction without touching another', () => {
    const store = memory();
    saveSession('a1', { token: 'x' }, store);
    saveSession('a2', { token: 'y' }, store);
    clearSession('a1', store);
    expect(loadSession('a1', store)).toBeNull();
    expect(loadSession('a2', store)).toEqual({ token: 'y' });
  });

  it('ignores damaged entries', () => {
    const store = memory();
    for (const raw of ['not json', 'null', '"x"', '{}', '{"token":""}', '{"token":5}']) {
      store.data.set('gavel:session:a1', raw);
      expect(loadSession('a1', store)).toBeNull();
    }
  });

  it('works without storage', () => {
    expect(loadSession('a1', null)).toBeNull();
    expect(saveSession('a1', { token: 'x' }, null)).toBe(false);
    expect(loadSession('a1', blocked)).toBeNull();
    expect(saveSession('a1', { token: 'x' }, blocked)).toBe(false);
    expect(() => clearSession('a1', blocked)).not.toThrow();
  });
});
