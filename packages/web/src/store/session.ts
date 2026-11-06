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

// One token per room: a tab that runs two auctions must never hand room A's token to room B.
const auctioneerTokens = new Map<string, string>();
// The invite slot is separate, so a single-use invite is never read as an auctioneer token.
const inviteTokens = new Map<string, string>();

function readSlot(
  slot: Map<string, string>,
  roomId: string,
  source: FragmentSource | undefined,
): string | null {
  try {
    const win: FragmentSource | null = source ?? (typeof window === 'undefined' ? null : window);
    const token = win === null ? null : tokenFromHash(win.location.hash);
    if (win === null || token === null) return slot.get(roomId) ?? null;
    slot.set(roomId, token);
    try {
      win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}`);
    } catch {
      // The address bar keeps the fragment; the token is still held.
    }
    return token;
  } catch {
    return slot.get(roomId) ?? null;
  }
}

function tokenFromHash(hash: string): string | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (body === '') return null;
  const token = body.includes('=') ? new URLSearchParams(body).get('token') : body;
  return token === null || token === '' ? null : token;
}

/**
 * Reads the auctioneer token for one room from the URL fragment, clears the fragment from the
 * address bar, and keeps the token in memory under that room id. A fragment always wins over the
 * remembered token; without one, the token remembered for this room (and no other) is returned.
 */
export function readAuctioneerToken(roomId: string, source?: FragmentSource): string | null {
  return readSlot(auctioneerTokens, roomId, source);
}

/** Same as readAuctioneerToken, for the single-use invite on the register route. */
export function readInviteToken(roomId: string, source?: FragmentSource): string | null {
  return readSlot(inviteTokens, roomId, source);
}

/** Forgets the in-memory token for one room, or for every room when none is named. */
export function clearAuctioneerToken(roomId?: string): void {
  if (roomId === undefined) {
    auctioneerTokens.clear();
    inviteTokens.clear();
  } else {
    auctioneerTokens.delete(roomId);
    inviteTokens.delete(roomId);
  }
}

/** True when this device holds an auctioneer token for the room. A bidder session never counts. */
export function hasAuctioneerAccess(roomId: string): boolean {
  return readAuctioneerToken(roomId) !== null;
}
