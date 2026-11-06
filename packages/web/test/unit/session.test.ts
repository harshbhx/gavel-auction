import { describe, expect, it } from 'vitest';
import { clearSession, loadSession, saveSession, type StorageLike } from '../../src/net/session';
import {
  clearAuctioneerToken,
  getBidderSession,
  hasAuctioneerAccess,
  readInviteToken,
  readAuctioneerToken,
  type FragmentSource,
} from '../../src/store/session';

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

describe('room identity (R-WEB-029)', () => {
  function fakeWindow(hash: string): FragmentSource & { urls: string[] } {
    const urls: string[] = [];
    return {
      urls,
      location: { hash, pathname: '/auctioneer', search: '?r=1' },
      history: { replaceState: (_d, _u, url) => void urls.push(url) },
    };
  }

  it('reads the bidder session and survives blocked storage', () => {
    const store = memory();
    saveSession('a1', { token: 't', bidderId: 'b' }, store);
    expect(getBidderSession('a1', store)).toEqual({ token: 't', bidderId: 'b' });
    expect(getBidderSession('a1', blocked)).toBeNull();
  });

  it('reads the auctioneer token once, clears the fragment and keeps it in memory', () => {
    clearAuctioneerToken();
    const win = fakeWindow('#token=abc.def');
    expect(readAuctioneerToken('r1', win)).toBe('abc.def');
    expect(win.urls).toEqual(['/auctioneer?r=1']);
    expect(readAuctioneerToken('r1', fakeWindow(''))).toBe('abc.def');
    clearAuctioneerToken();
    expect(readAuctioneerToken('r1', fakeWindow(''))).toBeNull();
  });

  it('keeps the invite slot apart from the auctioneer slot and ignores bidder sessions', () => {
    clearAuctioneerToken();
    expect(readInviteToken('r1', fakeWindow('#token=invite-word'))).toBe('invite-word');
    expect(readAuctioneerToken('r1', fakeWindow(''))).toBeNull();
    expect(hasAuctioneerAccess('r1')).toBe(false);
    clearAuctioneerToken();
  });

  it('keeps one token per room', () => {
    clearAuctioneerToken();
    expect(readAuctioneerToken('r1', fakeWindow('#token=first'))).toBe('first');
    expect(readAuctioneerToken('r2', fakeWindow(''))).toBeNull();
    expect(readAuctioneerToken('r2', fakeWindow('#token=second'))).toBe('second');
    expect(readAuctioneerToken('r1', fakeWindow(''))).toBe('first');
    clearAuctioneerToken();
  });

  it('still returns the token when the address bar cannot be rewritten', () => {
    clearAuctioneerToken();
    const win = fakeWindow('#raw-token');
    win.history.replaceState = () => {
      throw new Error('blocked');
    };
    expect(readAuctioneerToken('r1', win)).toBe('raw-token');
    clearAuctioneerToken();
  });
});
