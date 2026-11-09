/**
 * The keys of one judge room, kept in memory for this tab and carried in the hub link fragment so
 * a reload or a copied hub link still has them. A fragment never reaches a server.
 */
export interface HubKeys {
  /** Console token. Also lets the hub mint bidder invites. */
  readonly auctioneer: string | null;
  /** Big screen token. */
  readonly screen: string | null;
  /** When the room is deleted, in epoch ms. */
  readonly expiresAt: number | null;
  /** Short join code, when the creating response had it. */
  readonly code: string | null;
  /** Read-only reviewer token: opens the audit trail and the ledger check, nothing else. */
  readonly reviewer?: string | null;
}

export const NO_KEYS: HubKeys = { auctioneer: null, screen: null, expiresAt: null, code: null };

/** A judge room lives this long (the host's JUDGE_ROOM_TTL_MS default). */
export const ROOM_MINUTES = 30;

const memory = new Map<string, HubKeys>();

// The keys also live in this tab's sessionStorage (never localStorage), so a reload of the hub or
// a "Back to hub" link from a screen tab still has them. They are dropped when the room expires.
type HubStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const hubStoreKey = (roomId: string): string => `gavel:session:${roomId}:hub`;
const storedHubRooms = new Set<string>();

function tabStorage(): HubStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function loadStored(roomId: string, storage: HubStorage | null): HubKeys | null {
  try {
    const raw = storage?.getItem(hubStoreKey(roomId)) ?? null;
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
    const exp = typeof parsed['expiresAt'] === 'number' ? parsed['expiresAt'] : null;
    return {
      auctioneer: str(parsed['auctioneer']),
      screen: str(parsed['screen']),
      expiresAt: exp,
      code: str(parsed['code']),
      reviewer: str(parsed['reviewer']),
    };
  } catch {
    return null;
  }
}

function saveStored(roomId: string, keys: HubKeys, storage: HubStorage | null): void {
  try {
    storage?.setItem(hubStoreKey(roomId), JSON.stringify(keys));
    storedHubRooms.add(roomId);
  } catch {
    // Blocked or full: the in-memory copy still works.
  }
}

function isExpired(keys: HubKeys, now: number): boolean {
  return keys.expiresAt !== null && keys.expiresAt <= now;
}

/** What this tab remembers for the room: memory first, then sessionStorage; expired keys are dropped. */
function known(roomId: string, storage: HubStorage | null, now: number): HubKeys {
  const held = memory.get(roomId) ?? loadStored(roomId, storage);
  if (held === null) return NO_KEYS;
  if (isExpired(held, now)) {
    forgetHubRoom(roomId, storage);
    return NO_KEYS;
  }
  return held;
}

/** Forgets one room's keys in memory and in this tab's storage (room ended or expired). */
export function forgetHubRoom(roomId: string, storage: HubStorage | null = tabStorage()): void {
  memory.delete(roomId);
  try {
    storage?.removeItem(hubStoreKey(roomId));
  } catch {
    // Nothing to clear.
  }
}

function pick(params: URLSearchParams, name: string): string | null {
  const value = params.get(name);
  return value === null || value === '' ? null : value;
}

/** Reads hub keys from a URL fragment such as `#token=a&screen=b&exp=1&code=K7M2QX`. */
export function parseHubFragment(hash: string): HubKeys {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(body);
  const rawExp = pick(params, 'exp');
  const exp = rawExp !== null && /^\d{1,15}$/.test(rawExp) ? Number(rawExp) : null;
  return {
    auctioneer: pick(params, 'token'),
    screen: pick(params, 'screen'),
    expiresAt: exp,
    code: pick(params, 'code'),
    reviewer: pick(params, 'review'),
  };
}

function merge(base: HubKeys, over: HubKeys): HubKeys {
  return {
    auctioneer: over.auctioneer ?? base.auctioneer,
    screen: over.screen ?? base.screen,
    expiresAt: over.expiresAt ?? base.expiresAt,
    code: over.code ?? base.code,
    reviewer: over.reviewer ?? base.reviewer ?? null,
  };
}

export function rememberHubKeys(
  roomId: string,
  keys: HubKeys,
  storage: HubStorage | null = tabStorage(),
): void {
  const merged = merge(known(roomId, storage, Date.now()), keys);
  memory.set(roomId, merged);
  saveStored(roomId, merged, storage);
}

/** The keys in the fragment, merged over what this tab already remembers for the room. */
export function readHubKeys(
  roomId: string,
  hash: string = window.location.hash,
  storage: HubStorage | null = tabStorage(),
): HubKeys {
  const found = merge(known(roomId, storage, Date.now()), parseHubFragment(hash));
  memory.set(roomId, found);
  if (found !== NO_KEYS && hubFragment(found) !== '') saveStored(roomId, found, storage);
  return found;
}

export function forgetHubKeys(storage: HubStorage | null = tabStorage()): void {
  for (const id of [...storedHubRooms]) forgetHubRoom(id, storage);
  memory.clear();
}

/** Fragment text for a hub link. Empty fields are left out. */
export function hubFragment(keys: HubKeys): string {
  const params = new URLSearchParams();
  if (keys.auctioneer !== null) params.set('token', keys.auctioneer);
  if (keys.screen !== null) params.set('screen', keys.screen);
  if (keys.expiresAt !== null) params.set('exp', String(keys.expiresAt));
  if (keys.code !== null) params.set('code', keys.code);
  if (keys.reviewer !== undefined && keys.reviewer !== null) params.set('review', keys.reviewer);
  const text = params.toString();
  return text === '' ? '' : `#${text}`;
}

/** Path of the hub for a room, with whatever keys this tab has (plus an optional console token and join code). */
export function hubHref(
  roomId: string,
  auctioneer: string | null = null,
  code: string | null = null,
): string {
  const have = merge(known(roomId, tabStorage(), Date.now()), { ...NO_KEYS, auctioneer, code });
  return `/r/${encodeURIComponent(roomId)}/hub${hubFragment(have)}`;
}

/** A room this tab made or opened: its id and the keys the tab holds for it. */
export interface KnownRoom {
  readonly roomId: string;
  readonly keys: HubKeys;
}

/**
 * The newest room this tab holds keys for that has not expired, or null. The /try page uses it to
 * show a real room code and real links, and to say nothing of the kind when there is no room.
 */
export function latestHubRoom(now: number = Date.now()): KnownRoom | null {
  let found: KnownRoom | null = null;
  for (const [roomId, keys] of memory) {
    const live = keys.expiresAt === null || keys.expiresAt > now;
    if (live && (keys.code !== null || keys.auctioneer !== null)) found = { roomId, keys };
  }
  return found;
}
