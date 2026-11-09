import { loadSession, saveSession, type StorageLike, type StoredSession } from '../net/session';

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
    const stored = storage === undefined ? loadSession(roomId) : loadSession(roomId, storage);
    return stored ?? bidderSessions.get(roomId) ?? null;
  } catch {
    return bidderSessions.get(roomId) ?? null;
  }
}

// The in-memory copy of a bidder session, so a tab whose storage is blocked still reaches the bid screen.
const bidderSessions = new Map<string, StoredSession>();

/** Keeps the session in memory first, then tries storage. Returns false when storage refused it. */
export function rememberBidderSession(
  roomId: string,
  session: StoredSession,
  storage?: StorageLike | null,
): boolean {
  bidderSessions.set(roomId, session);
  try {
    return storage === undefined
      ? saveSession(roomId, session)
      : saveSession(roomId, session, storage);
  } catch {
    return false;
  }
}

/** Forgets the in-memory bidder session for one room, or for every room when none is named. */
export function clearBidderSession(roomId?: string): void {
  if (roomId === undefined) bidderSessions.clear();
  else bidderSessions.delete(roomId);
}

/** Minimal view of the browser location that the fragment reader needs. */
export interface FragmentSource {
  location: { hash: string; pathname: string; search: string };
  history: { replaceState: (data: null, unused: string, url: string) => void };
  /** Where the tab keeps tokens across a reload. Only used with an injected source; the real window uses sessionStorage. */
  storage?: StorageLike | null;
}

type TokenSlot = 'auctioneer' | 'invite' | 'receipt';

// Tab-scoped keys. Never localStorage: a token must not outlive the tab or reach another one.
const tokenKey = (roomId: string, slot: TokenSlot): string => `gavel:session:${roomId}:tok-${slot}`;

function tabStorage(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function storageFor(source: FragmentSource | undefined): StorageLike | null {
  // A caller that supplies its own location also supplies its own storage (or none).
  return source === undefined ? tabStorage() : (source.storage ?? null);
}

function loadToken(storage: StorageLike | null, roomId: string, slot: TokenSlot): string | null {
  try {
    const raw = storage?.getItem(tokenKey(roomId, slot)) ?? null;
    return raw === null || raw === '' ? null : raw;
  } catch {
    return null;
  }
}

function saveToken(storage: StorageLike | null, roomId: string, slot: TokenSlot, token: string) {
  try {
    storage?.setItem(tokenKey(roomId, slot), token);
  } catch {
    // Blocked or full: the in-memory copy still works until the tab reloads.
  }
}

const SLOTS: readonly TokenSlot[] = ['auctioneer', 'invite', 'receipt'];

/** Rooms that stored a token this page load, so clearing every room can reach their keys. */
const storedRooms = new Set<string>();

// One token per room: a tab that runs two auctions must never hand room A's token to room B.
const auctioneerTokens = new Map<string, string>();
// The invite slot is separate, so a single-use invite is never read as an auctioneer token.
const inviteTokens = new Map<string, string>();

// The receipt slot is separate too: a receipt link token opens one read-only receipt and nothing else.
const receiptTokens = new Map<string, string>();

function readSlot(
  slot: Map<string, string>,
  name: TokenSlot,
  roomId: string,
  source: FragmentSource | undefined,
): string | null {
  const storage = name === 'invite' ? null : storageFor(source);
  const fallback = (): string | null => {
    const held = slot.get(roomId);
    if (held !== undefined) return held;
    const stored = loadToken(storage, roomId, name);
    if (stored !== null) slot.set(roomId, stored);
    return stored;
  };
  try {
    const win: FragmentSource | null = source ?? (typeof window === 'undefined' ? null : window);
    const token = win === null ? null : tokenFromHash(win.location.hash);
    if (win === null || token === null) return fallback();
    slot.set(roomId, token);
    if (storage !== null) {
      saveToken(storage, roomId, name, token);
      storedRooms.add(roomId);
    }
    try {
      win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}`);
    } catch {
      // The address bar keeps the fragment; the token is still held.
    }
    return token;
  } catch {
    return fallback();
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
 * address bar, and keeps the token in memory (and in this tab's sessionStorage, so a reload keeps it) under that room id. A fragment always wins over the
 * remembered token; without one, the token remembered for this room (and no other) is returned.
 */
export function readAuctioneerToken(roomId: string, source?: FragmentSource): string | null {
  return readSlot(auctioneerTokens, 'auctioneer', roomId, source);
}

/** Same as readAuctioneerToken, for the single-use invite on the register route. */
export function readInviteToken(roomId: string, source?: FragmentSource): string | null {
  return readSlot(inviteTokens, 'invite', roomId, source);
}

/**
 * Reads the receipt token of a shared receipt link from the URL fragment, clears the fragment from
 * the address bar and keeps the token in memory under that room id, for this tab only.
 */
export function readReceiptToken(roomId: string, source?: FragmentSource): string | null {
  return readSlot(receiptTokens, 'receipt', roomId, source);
}

/**
 * Forgets the in-memory tokens for one room, or for every room when none is named. A named room
 * keeps its bidder session: a refused console token must never sign the bidder out.
 */
export function clearAuctioneerToken(roomId?: string, storage?: StorageLike | null): void {
  const store = storage === undefined ? tabStorage() : storage;
  const rooms = roomId === undefined ? [...storedRooms] : [roomId];
  for (const id of rooms) {
    for (const slot of SLOTS) {
      try {
        store?.removeItem(tokenKey(id, slot));
      } catch {
        // Nothing to clear.
      }
    }
  }
  if (roomId === undefined) storedRooms.clear();
  if (roomId === undefined) {
    auctioneerTokens.clear();
    inviteTokens.clear();
    receiptTokens.clear();
    bidderSessions.clear();
  } else {
    auctioneerTokens.delete(roomId);
    inviteTokens.delete(roomId);
    receiptTokens.delete(roomId);
  }
}

/**
 * Empties the in-memory token maps and leaves the tab's storage alone, which is exactly what a page
 * reload does. Tests use it to check that a reload keeps the tokens.
 */
export function dropInMemoryTokens(): void {
  auctioneerTokens.clear();
  inviteTokens.clear();
  receiptTokens.clear();
}

/** Forgets only the receipt token of one room, in memory and in this tab's storage (it was refused). */
export function clearReceiptToken(roomId: string, storage?: StorageLike | null): void {
  receiptTokens.delete(roomId);
  try {
    (storage === undefined ? tabStorage() : storage)?.removeItem(tokenKey(roomId, 'receipt'));
  } catch {
    // Nothing to clear.
  }
}

/** True when this device holds an auctioneer token for the room. A bidder session never counts. */
export function hasAuctioneerAccess(roomId: string): boolean {
  return readAuctioneerToken(roomId) !== null;
}

/** True when this device holds a token that opens the audit view: a reviewer or auctioneer link. */
export function hasReviewerAccess(roomId: string): boolean {
  return readAuctioneerToken(roomId) !== null;
}
