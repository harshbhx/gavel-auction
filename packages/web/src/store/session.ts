import { loadSession, type StorageLike, type StoredSession } from '../net/session';

/**
 * Who this device is in a room (R-WEB-029). The bidder identity comes from sessionStorage and
 * the auctioneer token from the URL fragment, held in memory only. Nothing here may throw: the
 * app must keep working when storage is blocked.
 */
export function getBidderSession(
  roomId: string,
  storage?: StorageLike | null,
): StoredSession | null {
  try {
    return storage === undefined ? loadSession(roomId) : loadSession(roomId, storage);
  } catch {
    return null;
  }
}

/** Minimal view of the browser location that the fragment reader needs. */
export interface FragmentSource {
  location: { hash: string; pathname: string; search: string };
  history: { replaceState: (data: null, unused: string, url: string) => void };
}

let auctioneerToken: string | null = null;

function tokenFromHash(hash: string): string | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (body === '') return null;
  const token = body.includes('=') ? new URLSearchParams(body).get('token') : body;
  return token === null || token === '' ? null : token;
}

/**
 * Reads the auctioneer token from the URL fragment on first call, clears the fragment from the
 * address bar, and keeps the token in memory. Later calls return the remembered token.
 */
export function readAuctioneerToken(source?: FragmentSource): string | null {
  if (auctioneerToken !== null) return auctioneerToken;
  try {
    const win: FragmentSource | null = source ?? (typeof window === 'undefined' ? null : window);
    if (win === null) return null;
    const token = tokenFromHash(win.location.hash);
    if (token === null) return null;
    auctioneerToken = token;
    try {
      win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}`);
    } catch {
      // The address bar keeps the fragment; the token is still held.
    }
    return auctioneerToken;
  } catch {
    return null;
  }
}

/** Forgets the in-memory token (sign out, and tests). */
export function clearAuctioneerToken(): void {
  auctioneerToken = null;
}
