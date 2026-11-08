import { DemoRoomError, type DemoLinks } from '../screens/demo/DemoLauncher';
import { retryAfterSeconds } from './apiError';
import { hubFragment, rememberHubKeys, type HubKeys } from '../screens/hub/hubKeys';

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
 */
export function createJudgeRoom(apiBase: string, goalCents?: number): Promise<DemoLinks> {
  // Rapid double clicks share one request: a second POST would make a second room.
  const key = `${apiBase}|${goalCents ?? ''}`;
  const pending = inFlight.get(key);
  if (pending !== undefined) return pending;
  const made = postJudgeRoom(apiBase, goalCents);
  inFlight.set(key, made);
  const clear = (): void => {
    inFlight.delete(key);
  };
  made.then(clear, clear);
  return made;
}

const inFlight = new Map<string, Promise<DemoLinks>>();

async function postJudgeRoom(apiBase: string, goalCents?: number): Promise<DemoLinks> {
  const res = await fetch(`${apiBase}/api/judge/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(goalCents === undefined ? {} : { fundraiserGoalCents: goalCents }),
  });
  if (res.status === 404) throw new DemoRoomError('demoOff');
  if (res.status === 429) {
    // A full house (room cap) is "busy"; every other 429 is a rate limit with a wait time.
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (field(body, 'error') === 'judge_room_cap') throw new DemoRoomError('judgeBusy');
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
  const rawExp = field(body, 'expiresAt');
  const rawCode = field(body, 'joinCode');
  const keys: HubKeys = {
    auctioneer,
    screen,
    expiresAt: typeof rawExp === 'number' && Number.isFinite(rawExp) ? Math.round(rawExp) : null,
    code: typeof rawCode === 'string' && rawCode !== '' ? rawCode : null,
  };
  rememberHubKeys(roomId, keys);
  return {
    console: `${base}/console#token=${auctioneer}`,
    screen: `${base}/screen#token=${screen}`,
    bidder: `/join/${id}`,
    audit: `${base}/audit`,
    hub: `${base}/hub${hubFragment(keys)}`,
  };
}
