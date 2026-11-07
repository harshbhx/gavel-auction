import { DemoRoomError, type DemoLinks } from '../screens/demo/DemoLauncher';

/** Asks the host whether key-less judge rooms are on and have a free slot. Never throws. */
export async function judgeRoomsAvailable(apiBase: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase}/api/judge/capabilities`);
    if (!res.ok) return false;
    const body = (await res.json()) as unknown;
    if (typeof body !== 'object' || body === null) return false;
    const flags = body as { judgeRooms?: unknown; accepting?: unknown };
    return flags.judgeRooms === true && flags.accepting === true;
  } catch {
    return false;
  }
}

function text(body: unknown, key: string): string {
  const value =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : null;
  if (typeof value !== 'string' || value === '') throw new Error('bad judge room');
  return value;
}

/** Creates a real sandbox room with no operator key. The room tokens ride in the link fragment. */
export async function createJudgeRoom(apiBase: string): Promise<DemoLinks> {
  const res = await fetch(`${apiBase}/api/judge/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (res.status === 404) throw new DemoRoomError('demoOff');
  if (res.status === 429 || res.status === 503) throw new DemoRoomError('judgeBusy');
  if (res.status !== 201) throw new Error('judge room failed');
  const body = (await res.json()) as unknown;
  const id = encodeURIComponent(text(body, 'auctionId'));
  const base = `/r/${id}`;
  return {
    console: `${base}/console#token=${text(body, 'auctioneerToken')}`,
    screen: `${base}/screen#token=${text(body, 'screenToken')}`,
    bidder: `/join/${id}`,
    audit: `${base}/audit`,
  };
}
