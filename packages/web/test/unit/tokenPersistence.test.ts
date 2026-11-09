import { describe, expect, it } from 'vitest';
import {
  forgetHubRoom,
  hubFragment,
  parseHubFragment,
  readHubKeys,
  rememberHubKeys,
} from '../../src/screens/hub/hubKeys';
import {
  clearAuctioneerToken,
  clearReceiptToken,
  dropInMemoryTokens,
  readAuctioneerToken,
  readReceiptToken,
  type FragmentSource,
} from '../../src/store/session';
import type { StorageLike } from '../../src/net/session';

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function source(hash: string, storage: StorageLike | null): FragmentSource {
  return {
    location: { hash, pathname: '/r/room-a/console', search: '' },
    history: { replaceState: () => {} },
    storage,
  };
}

describe('tokens survive a reload in this tab (#2225)', () => {
  it('stores the fragment token and returns it after the memory is gone', () => {
    const storage = memory();
    expect(readAuctioneerToken('room-a', source('#token=abc12345', storage))).toBe('abc12345');
    dropInMemoryTokens();
    expect(readAuctioneerToken('room-a', source('', storage))).toBe('abc12345');
    expect(readAuctioneerToken('room-b', source('', storage))).toBeNull();
    clearAuctioneerToken('room-a', storage);
  });

  it('keeps the receipt token the same way, in its own slot', () => {
    const storage = memory();
    readReceiptToken('room-a', source('#token=receipt-1', storage));
    dropInMemoryTokens();
    expect(readReceiptToken('room-a', source('', storage))).toBe('receipt-1');
    expect(readAuctioneerToken('room-a', source('', storage))).toBeNull();
    clearReceiptToken('room-a', storage);
    dropInMemoryTokens();
    expect(readReceiptToken('room-a', source('', storage))).toBeNull();
  });

  it('clearing a room removes its stored tokens', () => {
    const storage = memory();
    readAuctioneerToken('room-a', source('#token=abc12345', storage));
    clearAuctioneerToken('room-a', storage);
    dropInMemoryTokens();
    expect(readAuctioneerToken('room-a', source('', storage))).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('works when storage is blocked', () => {
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
    expect(readAuctioneerToken('room-z', source('#token=abc12345', blocked))).toBe('abc12345');
    expect(readAuctioneerToken('room-z', source('', blocked))).toBe('abc12345');
    dropInMemoryTokens();
    expect(readAuctioneerToken('room-z', source('', blocked))).toBeNull();
  });
});

describe('hub keys survive a reload in this tab (#2225)', () => {
  const hash = '#token=cons12345&screen=scr12345&review=rev12345&code=K7M2QX';

  it('restores the keys from storage when the address has no fragment', () => {
    const storage = memory();
    const first = readHubKeys('room-h', hash, storage);
    expect(first.auctioneer).toBe('cons12345');
    // A reload: nothing in the address, the keys come back from the tab's storage.
    const again = readHubKeys('room-h', '', storage);
    expect(again.screen).toBe('scr12345');
    expect(again.reviewer).toBe('rev12345');
    expect(hubFragment(again)).toBe(hubFragment(parseHubFragment(hash)));
    forgetHubRoom('room-h', storage);
    expect(storage.data.size).toBe(0);
  });

  it('drops keys of a room that has expired', () => {
    const storage = memory();
    rememberHubKeys('room-x', { ...parseHubFragment(hash), expiresAt: 1 }, storage);
    const keys = readHubKeys('room-x', '', storage);
    expect(keys.auctioneer).toBeNull();
    expect(storage.data.size).toBe(0);
  });
});
