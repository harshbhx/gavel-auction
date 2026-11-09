import { DemoRoomError, type DemoLinks } from '../screens/demo/DemoLauncher';
import { retryAfterSeconds } from './apiError';
import { hubFragment, rememberHubKeys, type HubKeys } from '../screens/hub/hubKeys';
import { JUDGE_KEY_HEADER } from './judgeKey';
import { recordRoom } from '../home/history';

/** Asks the host whether key-less judge rooms are on and have a free slot. Never throws. */
export async function judgeRoomsAvailable(apiBase: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase}/api/judge/capabilities`);
    // A rate limit says nothing about the switch: keep the key-less path and let the create
    // call report the wait, instead of dropping to the operator-key screen.
    if (res.status === 429) return true;
    if (!res.ok) return false;
    const body = (await res.json()) as unknown;
    if (typeof body !== 'object' || body === null) return false;
    const flags = body as { judgeRooms?: unknown; accepting?: unknown };
    return flags.judgeRooms === true && flags.accepting === true;
  } catch {
    return false;
  }
}

/** What the host says about key-less rooms: on, full or paused, switched off, or not answering. */
export type JudgeRoomsStatus = 'on' | 'busy' | 'off' | 'unreachable';

/** Like `judgeRoomsAvailable`, but keeps the reason, so the judge panel can say what is wrong. */
export async function judgeRoomsStatus(apiBase: string): Promise<JudgeRoomsStatus> {
  try {
    const res = await fetch(`${apiBase}/api/judge/capabilities`);
    if (res.status === 404) return 'off';
    if (res.status === 429) return 'on';
    if (!res.ok) return 'unreachable';
    const body = (await res.json()) as unknown;
    if (typeof body !== 'object' || body === null) return 'unreachable';
    const flags = body as { judgeRooms?: unknown; accepting?: unknown };
    if (flags.judgeRooms !== true) return 'off';
    return flags.accepting === true ? 'on' : 'busy';
  } catch {
    return 'unreachable';
  }
}

function field(body: unknown, key: string): unknown {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : null;
}

function text(body: unknown, key: string): string {
  const value = field(body, key);
  if (typeof value !== 'string' || value === '') throw new Error('bad judge room');
  return value;
}

/**
 * Creates a real sandbox room with no operator key. The room tokens ride in the link fragment.
 * `goalCents` is the optional fundraiser goal; left out, the big screen shows no thermometer.
 * With a judge key (header only, never a URL) the host lifts its public limits within a bound.
 */
export function createJudgeRoom(
  apiBase: string,
  goalCents?: number,
  judgeKey?: string,
): Promise<DemoLinks> {
  // Rapid double clicks share one request: a second POST would make a second room.
  const key = `${apiBase}|${goalCents ?? ''}|${judgeKey === undefined ? '' : 'k'}`;
  const pending = inFlight.get(key);
  if (pending !== undefined) return pending;
  const made = postJudgeRoom(apiBase, goalCents, judgeKey);
  inFlight.set(key, made);
  const clear = (): void => {
    inFlight.delete(key);
  };
  made.then(clear, clear);
  return made;
}

const inFlight = new Map<string, Promise<DemoLinks>>();

async function postJudgeRoom(
  apiBase: string,
  goalCents?: number,
  judgeKey?: string,
): Promise<DemoLinks> {
  const res = await fetch(`${apiBase}/api/judge/rooms`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(judgeKey === undefined ? {} : { [JUDGE_KEY_HEADER]: judgeKey }),
    },
    body: JSON.stringify(goalCents === undefined ? {} : { fundraiserGoalCents: goalCents }),
  });
  if (res.status === 404) throw new DemoRoomError('demoOff');
  if (res.status === 401 && judgeKey !== undefined) throw new DemoRoomError('keyWrong');
  if (res.status === 429) {
    // A full house (room cap) is "busy"; every other 429 is a rate limit with a wait time.
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const code = field(body, 'error');
    if (judgeKey !== undefined && code === 'judge_key_locked') throw new DemoRoomError('keyLocked');
    if (judgeKey !== undefined && code === 'judge_key_room_cap') throw new DemoRoomError('keyCap');
    if (code === 'judge_room_cap') throw new DemoRoomError('judgeBusy');
    throw new DemoRoomError('rateLimited', retryAfterSeconds(res));
  }
  if (res.status === 503) throw new DemoRoomError('judgeBusy');
  if (res.status !== 201) throw new Error('judge room failed');
  const body = (await res.json()) as unknown;
  const roomId = text(body, 'auctionId');
  const id = encodeURIComponent(roomId);
  const base = `/r/${id}`;
  const auctioneer = text(body, 'auctioneerToken');
  const screen = text(body, 'screenToken');
  const rawReviewer = field(body, 'reviewerToken');
  const reviewer = typeof rawReviewer === 'string' && rawReviewer !== '' ? rawReviewer : null;
  const rawExp = field(body, 'expiresAt');
  const rawCode = field(body, 'joinCode');
  const keys: HubKeys = {
    auctioneer,
    screen,
    reviewer,
    expiresAt: typeof rawExp === 'number' && Number.isFinite(rawExp) ? Math.round(rawExp) : null,
    code: typeof rawCode === 'string' && rawCode !== '' ? rawCode : null,
  };
  rememberHubKeys(roomId, keys);
  // Browser history for the Home screen: the room id, role and join code only, never a token.
  recordRoom(roomId, { role: 'auctioneer', expiresAt: keys.expiresAt, code: keys.code });
  return {
    console: `${base}/console#token=${auctioneer}`,
    screen: `${base}/screen#token=${screen}`,
    bidder: `/join/${id}`,
    audit: reviewer === null ? `${base}/audit` : `${base}/audit#token=${reviewer}`,
    hub: `${base}/hub${hubFragment(keys)}`,
  };
}

/** What the ledger route answered, as far as the verify area cares. */
export type LedgerFetch =
  | { readonly kind: 'ok'; readonly ledger: unknown }
  | { readonly kind: 'notYet' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'failed' };

/** Reads a judge room's hash-chained ledger with its read-only reviewer token. Never throws. */
export async function fetchRoomLedger(
  apiBase: string,
  roomId: string,
  reviewerToken: string,
): Promise<LedgerFetch> {
  try {
    const res = await fetch(`${apiBase}/api/judge/rooms/${encodeURIComponent(roomId)}/ledger`, {
      headers: { authorization: `Bearer ${reviewerToken}` },
    });
    if (res.ok) return { kind: 'ok', ledger: (await res.json()) as unknown };
    if (res.status === 404) return { kind: 'notYet' };
    if (res.status === 401 || res.status === 403) return { kind: 'denied' };
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}
