/**
 * The registration id of an approval attempt, kept in sessionStorage per room and bidder
 * (R-WEB-029, R-WEB-044). A reload, or the return from PayPal's approval page, then reuses the id
 * the server already saw, so the server can match it to the first order instead of creating a
 * second hold. Every access is wrapped: storage can be missing or blocked.
 */
export interface StoredRegistration {
  clientRegistrationId: string;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PREFIX = 'gavel:registration:';

function defaultStorage(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

const keyOf = (roomId: string, bidderId: string): string =>
  `${PREFIX}${encodeURIComponent(roomId)}:${encodeURIComponent(bidderId)}`;

export function loadRegistration(
  roomId: string,
  bidderId: string,
  storage: StorageLike | null = defaultStorage(),
): StoredRegistration | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(keyOf(roomId, bidderId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    const id = (parsed as { clientRegistrationId?: unknown } | null)?.clientRegistrationId;
    return typeof id === 'string' && id !== '' ? { clientRegistrationId: id } : null;
  } catch {
    return null;
  }
}

export function saveRegistration(
  roomId: string,
  bidderId: string,
  registration: StoredRegistration,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(keyOf(roomId, bidderId), JSON.stringify(registration));
  } catch {
    // Not stored: the attempt still works in memory.
  }
}

export function clearRegistration(
  roomId: string,
  bidderId: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.removeItem(keyOf(roomId, bidderId));
  } catch {
    // Nothing to clear.
  }
}

/** Test helper: drop every stored registration. */
export function clearAllRegistrations(): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key !== null && key.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // Nothing to clear.
  }
}
