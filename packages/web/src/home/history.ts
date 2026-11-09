/**
 * What this browser remembers about the rooms its owner took part in, so a returning visitor lands on
 * a Home screen that knows them. It lives in localStorage under one versioned key, holds at most ten
 * rooms, and keeps a small summary of each: never a token, a secret, an email or card data. Session
 * tokens stay in sessionStorage where they already are. Every access is wrapped: storage can be
 * missing, blocked, full or corrupt, and the app must work the same without it.
 */
import { HISTORY_KEY } from './historyKey';

export { HISTORY_KEY };
export const HISTORY_VERSION = 1;
export const MAX_ROOMS = 10;

export type HistoryRole = 'auctioneer' | 'bidder' | 'watcher';
export type HistoryResult = 'won' | 'lost' | 'stopped' | 'closed' | 'open';

export interface HistoryRoom {
  readonly roomId: string;
  readonly roles: readonly HistoryRole[];
  readonly createdAt: number;
  readonly lastSeenAt: number;
  /** When the host deletes the room, in epoch ms, when known. */
  readonly expiresAt: number | null;
  readonly lotTitle: string | null;
  readonly lastPriceCents: number | null;
  /** The ceiling this visitor set as a bidder, in cents. */
  readonly holdCents: number | null;
  readonly result: HistoryResult;
  readonly paddle: number | null;
  readonly name: string | null;
  /** True once the room reached the hammer, so a receipt exists while the room is reachable. */
  readonly receipt: boolean;
  /** The public join code of the room, when the creating response had one. */
  readonly code: string | null;
}

/** What a caller may change on a room. Every field is optional; the role is added to the set. */
export interface HistoryPatch {
  readonly role?: HistoryRole;
  readonly expiresAt?: number | null;
  readonly lotTitle?: string | null;
  readonly lastPriceCents?: number | null;
  readonly holdCents?: number | null;
  readonly result?: HistoryResult;
  readonly paddle?: number | null;
  readonly name?: string | null;
  readonly receipt?: boolean;
  readonly code?: string | null;
}

export type HistoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const ROLES: readonly HistoryRole[] = ['auctioneer', 'bidder', 'watcher'];
const RESULTS: readonly HistoryResult[] = ['won', 'lost', 'stopped', 'closed', 'open'];

const MAX_TITLE = 80;
const MAX_NAME = 40;
const MAX_ID = 64;
const ID_SHAPE = /^[A-Za-z0-9_-]+$/;

function defaultStorage(): HistoryStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Keeps only the known fields with the right types, so nothing unexpected is ever kept or shown. */
function clean(raw: unknown): HistoryRoom | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const roomId = text(r['roomId'], MAX_ID);
  if (roomId === null || !ID_SHAPE.test(roomId)) return null;
  const lastSeenAt = whole(r['lastSeenAt']);
  if (lastSeenAt === null) return null;
  const roles = Array.isArray(r['roles'])
    ? ROLES.filter((role) => (r['roles'] as unknown[]).includes(role))
    : [];
  const result = RESULTS.find((x) => x === r['result']) ?? 'open';
  const code = text(r['code'], MAX_ID);
  return {
    roomId,
    roles,
    createdAt: whole(r['createdAt']) ?? lastSeenAt,
    lastSeenAt,
    expiresAt: whole(r['expiresAt']),
    lotTitle: text(r['lotTitle'], MAX_TITLE),
    lastPriceCents: whole(r['lastPriceCents']),
    holdCents: whole(r['holdCents']),
    result,
    paddle: whole(r['paddle']),
    name: text(r['name'], MAX_NAME),
    receipt: r['receipt'] === true,
    code: code !== null && ID_SHAPE.test(code) ? code : null,
  };
}

/** The remembered rooms, newest first. Corrupt, foreign or unversioned data reads as no history. */
export function readHistory(storage: HistoryStorage | null = defaultStorage()): HistoryRoom[] {
  if (storage === null) return [];
  try {
    const raw = storage.getItem(HISTORY_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const doc = parsed as { v?: unknown; rooms?: unknown };
    if (doc.v !== HISTORY_VERSION || !Array.isArray(doc.rooms)) return [];
    const rooms: HistoryRoom[] = [];
    for (const item of doc.rooms as unknown[]) {
      const room = clean(item);
      if (room !== null && !rooms.some((x) => x.roomId === room.roomId)) rooms.push(room);
    }
    return rooms.sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, MAX_ROOMS);
  } catch {
    return [];
  }
}

function write(rooms: readonly HistoryRoom[], storage: HistoryStorage | null): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify({ v: HISTORY_VERSION, rooms }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Adds a room or updates what is known about it, and moves it to the top. The oldest rooms past ten
 * are dropped. Returns false when storage refused the write; the caller never needs to react.
 */
export function recordRoom(
  roomId: string,
  patch: HistoryPatch = {},
  now: number = Date.now(),
  storage: HistoryStorage | null = defaultStorage(),
): boolean {
  if (!ID_SHAPE.test(roomId) || roomId.length > MAX_ID) return false;
  const rooms = readHistory(storage);
  const before = rooms.find((r) => r.roomId === roomId);
  const roles =
    patch.role === undefined || before?.roles.includes(patch.role) === true
      ? (before?.roles ?? [])
      : [...(before?.roles ?? []), patch.role];
  const pick = <T>(next: T | undefined, prev: T | undefined, fallback: T): T =>
    next !== undefined ? next : prev !== undefined ? prev : fallback;
  const merged = clean({
    roomId,
    roles,
    createdAt: before?.createdAt ?? now,
    lastSeenAt: now,
    expiresAt: pick(patch.expiresAt, before?.expiresAt, null),
    lotTitle: pick(patch.lotTitle, before?.lotTitle, null),
    lastPriceCents: pick(patch.lastPriceCents, before?.lastPriceCents, null),
    holdCents: pick(patch.holdCents, before?.holdCents, null),
    result: pick(patch.result, before?.result, 'open'),
    paddle: pick(patch.paddle, before?.paddle, null),
    name: pick(patch.name, before?.name, null),
    receipt: pick(patch.receipt, before?.receipt, false),
    code: pick(patch.code, before?.code, null),
  });
  if (merged === null) return false;
  const next = [merged, ...rooms.filter((r) => r.roomId !== roomId)].slice(0, MAX_ROOMS);
  return write(next, storage);
}

/** Forgets everything this browser remembered. */
export function clearHistory(storage: HistoryStorage | null = defaultStorage()): void {
  try {
    storage?.removeItem(HISTORY_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function hasHistory(storage: HistoryStorage | null = defaultStorage()): boolean {
  return readHistory(storage).length > 0;
}
