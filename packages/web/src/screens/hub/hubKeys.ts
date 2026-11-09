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
}

export const NO_KEYS: HubKeys = { auctioneer: null, screen: null, expiresAt: null, code: null };

/** A judge room lives this long (the host's JUDGE_ROOM_TTL_MS default). */
export const ROOM_MINUTES = 30;

const memory = new Map<string, HubKeys>();

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
  };
}

function merge(base: HubKeys, over: HubKeys): HubKeys {
  return {
    auctioneer: over.auctioneer ?? base.auctioneer,
    screen: over.screen ?? base.screen,
    expiresAt: over.expiresAt ?? base.expiresAt,
    code: over.code ?? base.code,
  };
}

export function rememberHubKeys(roomId: string, keys: HubKeys): void {
  memory.set(roomId, merge(memory.get(roomId) ?? NO_KEYS, keys));
}

/** The keys in the fragment, merged over what this tab already remembers for the room. */
export function readHubKeys(roomId: string, hash: string = window.location.hash): HubKeys {
  const found = merge(memory.get(roomId) ?? NO_KEYS, parseHubFragment(hash));
  memory.set(roomId, found);
  return found;
}

export function forgetHubKeys(): void {
  memory.clear();
}

/** Fragment text for a hub link. Empty fields are left out. */
export function hubFragment(keys: HubKeys): string {
  const params = new URLSearchParams();
  if (keys.auctioneer !== null) params.set('token', keys.auctioneer);
  if (keys.screen !== null) params.set('screen', keys.screen);
  if (keys.expiresAt !== null) params.set('exp', String(keys.expiresAt));
  if (keys.code !== null) params.set('code', keys.code);
  const text = params.toString();
  return text === '' ? '' : `#${text}`;
}

/** Path of the hub for a room, with whatever keys this tab has (plus an optional console token and join code). */
export function hubHref(
  roomId: string,
  auctioneer: string | null = null,
  code: string | null = null,
): string {
  const known = merge(memory.get(roomId) ?? NO_KEYS, { ...NO_KEYS, auctioneer, code });
  return `/r/${encodeURIComponent(roomId)}/hub${hubFragment(known)}`;
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
