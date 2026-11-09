import { type Stack } from '../runner/stack';
import { CEILING_CENTS } from './live-socket';

/**
 * Room and socket setup shared by the live /audio socket run and its CI test: create a room,
 * register bidders through the test-only enrol route, open their sockets, then open the audio
 * socket and wait for the server's ready. Nothing here needs a speech provider.
 */

/** The clips name paddles up to 14. */
export const BIDDERS = 14;

export type Frame = Record<string, unknown>;
export interface Sock {
  readyState: number;
  on(event: string, cb: (...args: unknown[]) => void): void;
  send(data: string | Uint8Array): void;
  close(code?: number): void;
}
export type SockCtor = new (url: string, opts: { headers: Record<string, string> }) => Sock;

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const now = (): number => Date.now();

export async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // The body of a failed test route is an error message, never a secret.
    const body = (await res.text()).slice(0, 200);
    throw new Error(`${new URL(res.url).pathname} answered ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

export function openSocket(
  make: SockCtor,
  url: string,
  origin: string,
  onMessage: (f: Frame) => void,
): Promise<Sock> {
  return new Promise((resolveOpen, reject) => {
    const sock = new make(url, { headers: { origin } });
    sock.on('message', (data) => {
      try {
        onMessage(JSON.parse(String(data)) as Frame);
      } catch {
        // not JSON: ignore
      }
    });
    sock.on('open', () => resolveOpen(sock));
    sock.on('error', (e) => reject(e instanceof Error ? e : new Error(String(e))));
  });
}

export interface Room {
  auctionId: string;
  auctioneerToken: string;
  bidderSockets: Sock[];
  /** Everything that reached a bidder socket, with the wall time and the paddle it belongs to. */
  seen: Array<{ at: number; paddle: string; frame: Frame }>;
}

export async function setUpRoom(stack: Stack, make: SockCtor, bidders = BIDDERS): Promise<Room> {
  const base = stack.serverUrl;
  const origin = new URL(base).origin;
  const adminHeaders = { 'content-type': 'application/json', 'x-admin-key': stack.adminKey };
  const created = await json<{ auctionId: string; auctioneerLink: string }>(
    await fetch(`${base}/api/auctions`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        title: 'voice-live-socket',
        config: {
          mode: 'english',
          currency: 'USD',
          reserve: 5000,
          minIncrement: 500,
          endTs: now() + 3_600_000,
          softCloseWindowMs: 30_000,
          softCloseExtensionMs: 30_000,
          maxExtensions: 5,
          ceilingPresets: [CEILING_CENTS],
          confirmConfidenceThreshold: 0.85,
        },
      }),
    }),
  );
  const auctionId = created.auctionId;
  const auctioneerToken = created.auctioneerLink.split('#token=')[1] ?? '';
  const bearer = { 'content-type': 'application/json', authorization: `Bearer ${auctioneerToken}` };
  const room: Room = { auctionId, auctioneerToken, bidderSockets: [], seen: [] };
  const wsUrl = `${base.replace(/^http/, 'ws')}/ws`;
  for (let i = 1; i <= bidders; i += 1) {
    const { invites } = await json<{ invites: Array<{ link: string }> }>(
      await fetch(`${base}/api/auctions/${auctionId}/invites`, {
        method: 'POST',
        headers: bearer,
        body: JSON.stringify({ count: 1 }),
      }),
    );
    const joined = await json<{ sessionToken: string; bidderId: string }>(
      await fetch(`${base}/api/auctions/${auctionId}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invite: invites[0]?.link.split('#token=')[1] ?? '' }),
      }),
    );
    await json(
      await fetch(`${base}/__e2e/enrol`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          auctionId,
          bidderId: joined.bidderId,
          name: `bidder ${i}`,
          ceilingCents: CEILING_CENTS,
          presetsCents: [CEILING_CENTS],
        }),
      }),
    );
    // Paddles are handed out in registration order, so bidder i holds paddle i.
    const paddle = String(i);
    const sock = await openSocket(make, wsUrl, origin, (frame) => {
      room.seen.push({ at: now(), paddle, frame });
    });
    sock.send(JSON.stringify({ v: 1, t: 'join', token: joined.sessionToken, auctionId }));
    room.bidderSockets.push(sock);
  }
  // A room is open from the moment it is created (the stack driver treats `open` as a no-op), and
  // asking again answers 409 "already open". Check the state the sockets report instead.
  await waitForOpen(room);
  return room;
}

/** Waits until a bidder socket reports the lot as OPEN; throws with the status it saw otherwise. */
export async function waitForOpen(room: Room, ms = 15_000): Promise<void> {
  const until = now() + ms;
  let status = 'no state frame';
  while (now() < until) {
    for (const { frame } of room.seen) {
      if (frame['t'] !== 'state') continue;
      const snap = frame['snapshot'] as { status?: unknown } | undefined;
      status = String(snap?.status ?? 'unknown');
      if (status === 'OPEN') return;
    }
    await sleep(25);
  }
  throw new Error(`the lot is not open after ${ms} ms (status: ${status})`);
}

export interface AudioConnection {
  sock: Sock;
  closeCode(): number | undefined;
  isReady(): boolean;
}

/**
 * Opens /audio for the room with the auctioneer token, sends the auth message and waits for the
 * server's ready. Throws when the socket does not open or ready never comes.
 */
export async function connectAudio(
  stack: Stack,
  make: SockCtor,
  room: Room,
  onFrame: (f: Frame) => void = () => undefined,
): Promise<AudioConnection> {
  const base = stack.serverUrl;
  const url = `${base.replace(/^http/, 'ws')}/audio?auction=${room.auctionId}&source=mic`;
  let ready = false;
  let closeCode: number | undefined;
  const sock = await openSocket(make, url, new URL(base).origin, (f) => {
    if (f['t'] === 'ready') ready = true;
    onFrame(f);
  });
  sock.on('close', (code) => {
    closeCode = typeof code === 'number' ? code : undefined;
  });
  sock.send(JSON.stringify({ t: 'auth', token: room.auctioneerToken }));
  const readyBy = now() + 10_000;
  while (!ready && closeCode === undefined && now() < readyBy) await sleep(25);
  if (!ready) {
    sock.close();
    throw new Error(`the server never sent ready (close code ${closeCode ?? 'none'})`);
  }
  return { sock, closeCode: () => closeCode, isReady: () => ready };
}
