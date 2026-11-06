/**
 * What the browser keeps for one auction so a reload or a redirect return does not turn a bidder
 * into a watcher (R-WEB-029). Held in sessionStorage, per auction and per role, and never shared
 * between tabs. Every access is wrapped: storage can be missing or blocked, and the app must
 * still work.
 */
export interface StoredSession {
  /** Bidder token, or the screen token a watcher was given. */
  token: string;
  bidderId?: string;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A device keeps one slot per role, so a screen token can never replace a bidder token. */
export type SessionRole = 'bidder' | 'screen';

const PREFIX = 'gavel:session:';

function defaultStorage(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

const keyOf = (auctionId: string, role: SessionRole): string => `${PREFIX}${auctionId}:${role}`;

export function loadSession(
  auctionId: string,
  storage: StorageLike | null = defaultStorage(),
  role: SessionRole = 'bidder',
): StoredSession | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(keyOf(auctionId, role));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { token, bidderId } = parsed as { token?: unknown; bidderId?: unknown };
    if (typeof token !== 'string' || token === '') return null;
    return typeof bidderId === 'string' ? { token, bidderId } : { token };
  } catch {
    return null;
  }
}

/** Returns false when the session could not be stored. */
export function saveSession(
  auctionId: string,
  session: StoredSession,
  storage: StorageLike | null = defaultStorage(),
  role: SessionRole = 'bidder',
): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(keyOf(auctionId, role), JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function clearSession(
  auctionId: string,
  storage: StorageLike | null = defaultStorage(),
  role: SessionRole = 'bidder',
): void {
  try {
    storage?.removeItem(keyOf(auctionId, role));
  } catch {
    // Nothing to clear.
  }
}

const HIGH_PREFIX = 'gavel:highbid:';

const highKey = (auctionId: string, bidderId: string): string =>
  `${HIGH_PREFIX}${auctionId}:${bidderId}`;

/** The bidder's own highest accepted amount for this auction, or 0 when none is stored. */
export function loadHighBid(
  auctionId: string,
  bidderId: string,
  storage: StorageLike | null = defaultStorage(),
): number {
  if (storage === null) return 0;
  try {
    const n = Number(storage.getItem(highKey(auctionId, bidderId)));
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveHighBid(
  auctionId: string,
  bidderId: string,
  cents: number,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(highKey(auctionId, bidderId), String(cents));
  } catch {
    // Storage is blocked or full; the snapshot still restores the amount.
  }
}
