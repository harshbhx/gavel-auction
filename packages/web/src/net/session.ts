/**
 * What the browser keeps for one auction so a reload or a redirect return does not turn a bidder
 * into a watcher (R-WEB-029). Held in sessionStorage, per auction, and never shared between tabs.
 * Every access is wrapped: storage can be missing or blocked, and the app must still work.
 */
export interface StoredSession {
  /** Bidder token, or the screen token a watcher was given. */
  token: string;
  bidderId?: string;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PREFIX = 'gavel:session:';

function defaultStorage(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

const keyOf = (auctionId: string): string => `${PREFIX}${auctionId}`;

export function loadSession(
  auctionId: string,
  storage: StorageLike | null = defaultStorage(),
): StoredSession | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(keyOf(auctionId));
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
): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(keyOf(auctionId), JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function clearSession(
  auctionId: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.removeItem(keyOf(auctionId));
  } catch {
    // Nothing to clear.
  }
}

const HIGH_PREFIX = 'gavel:highbid:';

/** The bidder's own highest accepted amount for this auction, or 0 when none is stored. */
export function loadHighBid(
  auctionId: string,
  storage: StorageLike | null = defaultStorage(),
): number {
  if (storage === null) return 0;
  try {
    const n = Number(storage.getItem(`${HIGH_PREFIX}${auctionId}`));
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveHighBid(
  auctionId: string,
  cents: number,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(`${HIGH_PREFIX}${auctionId}`, String(cents));
  } catch {
    // Storage is blocked or full; the snapshot still restores the amount.
  }
}
