import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { type AuctionId, type CancelTimer, type Clock, type RoomStore } from '@gavel/shared';
import {
  createVoiceSession,
  decodeBatch,
  type AudioErrorCode,
  type AudioStream,
  type SttProvider,
  type VoiceSessionDeps,
} from '@gavel/voice';
import { WebSocketServer, type WebSocket } from 'ws';
import { connectionTokenLive, auctioneerTokenLive } from '../auth/auctioneer-floor';
import { verifyRotating, type SecretSet } from '../auth/rotation';
import type { JtiStore, TokenPayload } from '../auth/token';
import type { AuctionService } from '../runtime/auction-service';
import { startVoiceBridge, type VoiceBridge } from '../voice/bridge';

export const AUDIO_PATH = '/audio';
/** Largest audio message: 12 byte header and ten 640 byte frames, with room to spare. */
export const AUDIO_MAX_PAYLOAD_BYTES = 8 * 1024;
/** How long a new socket may stay open without sending its auth message. */
export const AUDIO_AUTH_DEADLINE_MS = 5_000;
/** How often an open stream re-checks that its token is still good. */
const LIVENESS_MS = 10_000;

/** WebSocket close code for each audio error; the reason text is the error code itself. */
export const AUDIO_CLOSE_CODES: Readonly<Record<AudioErrorCode, number>> = {
  AUDIO_UNAUTHORIZED: 4401,
  AUDIO_BAD_FRAME: 1008,
  AUDIO_RATE_LIMIT: 4429,
  AUDIO_SESSION_LIMIT: 4408,
  AUDIO_STREAM_BUSY: 4409,
};

export interface AudioHostOptions {
  server: Server;
  clock: Clock;
  allowedOrigins: readonly string[];
  secrets: SecretSet;
  store: Pick<RoomStore, 'lastSeq' | 'isDenied' | 'getJournal' | 'putJournal'>;
  service: Pick<AuctionService, 'room'>;
  /** A new speech provider for each stream. */
  makeStt: () => SttProvider;
  /** Same admission hook as the room socket: return a release callback, or undefined for 429. */
  admitUpgrade?: (req: IncomingMessage) => (() => void) | undefined;
  session?: Partial<
    Pick<
      VoiceSessionDeps,
      | 'maxBytesPerSec'
      | 'maxFramesPerSec'
      | 'maxSessionMs'
      | 'maxStreamsPerToken'
      | 'maxStreamsPerRoom'
      | 'idleMs'
    >
  >;
  /** Time allowed between the upgrade and the auth message. Defaults to AUDIO_AUTH_DEADLINE_MS. */
  authDeadlineMs?: number;
  log?: (message: string, fields?: Record<string, string>) => void;
}

export interface AudioHost {
  close(): Promise<void>;
}

interface Pending {
  token: string;
  roomId: string;
  role: string;
}

function parseQuery(req: IncomingMessage): { path: string; params: URLSearchParams } {
  const url = req.url ?? '';
  const cut = url.indexOf('?');
  return {
    path: cut === -1 ? url : url.slice(0, cut),
    params: new URLSearchParams(cut === -1 ? '' : url.slice(cut + 1)),
  };
}

/** The token of an `{t:'auth', token}` text message, or undefined for anything else. */
function parseAuth(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== 'object' || v === null) return undefined;
    const m = v as { t?: unknown; token?: unknown };
    return m.t === 'auth' && typeof m.token === 'string' && m.token !== '' ? m.token : undefined;
  } catch {
    return undefined;
  }
}

function refuse(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/**
 * The /audio WebSocket (SPEC-voice section 5, voice-contracts section 2). The upgrade URL carries
 * `auction` and optionally `source`, never a credential, so nothing secret reaches proxy or
 * access logs. The first message on the socket must be the text frame `{"t":"auth","token":...}`
 * within `authDeadlineMs`; the token is the auctioneer token the room join uses, checked against
 * the same secrets, denylist and floor. Any other first message, a late or invalid token, or an
 * audio frame before auth closes the socket with 4401. Only after auth does the voice session
 * open and the bridge start; the server then sends `{"t":"ready"}` and the client may stream.
 * Binary frames only afterwards; the voice session enforces rate,
 * size, duration and one stream per (room, source).
 *
 * Room-mic design: the token is an AUCTIONEER token, the microphone is the room's. The bidder of
 * a spoken bid comes from the paddle the pipeline heard, never from the token, and decisions go
 * to the room through the voice bridge into `Room.submitVoiceBid`. That call runs as a throwaway
 * bidder connection that can only place a bid: the room's rate limit, confidence gate, confirm
 * hold, roster check and the engine all still apply, and it has no path to pause, stop, hammer
 * or enter a bid for another bidder.
 */
export function createAudioHost(opts: AudioHostOptions): AudioHost {
  const wss = new WebSocketServer({ noServer: true, maxPayload: AUDIO_MAX_PAYLOAD_BYTES });
  const allowed = new Set(opts.allowedOrigins);
  const jtis: JtiStore = {
    isRevoked: (jti) => opts.store.isDenied(jti as Parameters<RoomStore['isDenied']>[0]),
    consume: () => Promise.resolve(true),
  };
  // The session check is synchronous, so the token is verified first and handed over here for
  // the duration of one open() call.
  let pending: Pending | undefined;
  const session = createVoiceSession({
    now: () => opts.clock.now(),
    verifyToken: (token, roomId) =>
      pending !== undefined && pending.token === token && pending.roomId === roomId
        ? pending.role
        : null,
    ...opts.session,
  });
  const sockets = new Set<WebSocket>();

  const authenticate = async (
    auctionId: string,
    token: string,
  ): Promise<{ ok: true; payload: TokenPayload } | { ok: false; status: number }> => {
    const r = await verifyRotating(token, opts.secrets, {
      aud: auctionId,
      kinds: ['auctioneer'],
      nowMs: opts.clock.now(),
      jtis,
    });
    if (!r.ok || !(await auctioneerTokenLive(opts.store, r.payload))) {
      return { ok: false, status: 401 };
    }
    if ((await opts.store.lastSeq(auctionId as AuctionId)) === 0) return { ok: false, status: 404 };
    return { ok: true, payload: r.payload };
  };

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const { path, params } = parseQuery(req);
    if (path !== AUDIO_PATH) return;
    socket.on('error', () => undefined);
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !allowed.has(origin)) {
      refuse(socket, 403, 'Forbidden');
      return;
    }
    const release = opts.admitUpgrade ? opts.admitUpgrade(req) : () => undefined;
    if (release === undefined) {
      refuse(socket, 429, 'Too Many Requests');
      return;
    }
    socket.once('close', release);
    const auctionId = params.get('auction') ?? '';
    const source = (params.get('source') ?? 'mic').slice(0, 64) || 'mic';
    if (auctionId === '') {
      refuse(socket, 400, 'Bad Request');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.once('close', release);
      void bind(ws, auctionId, source);
    });
  };
  opts.server.on('upgrade', onUpgrade);

  async function bind(ws: WebSocket, auctionId: string, source: string): Promise<void> {
    sockets.add(ws);
    ws.on('error', () => undefined);
    let bridge: VoiceBridge | undefined;
    const held: { stream?: AudioStream } = {};
    const timers: Array<CancelTimer | undefined> = [];
    let ended = false;
    const teardown = (): void => {
      ended = true;
      for (const cancel of timers) cancel?.();
      held.stream?.close();
      void bridge?.close();
      sockets.delete(ws);
    };
    const end = (code: number, reason: string): void => {
      if (ended) return;
      teardown();
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(code, reason);
    };
    ws.once('close', teardown);

    // Until the auth message has been verified, no stream exists and no audio is accepted.
    const deadline = opts.authDeadlineMs ?? AUDIO_AUTH_DEADLINE_MS;
    timers[2] = opts.clock.setTimer(opts.clock.now() + deadline, () => {
      end(AUDIO_CLOSE_CODES.AUDIO_UNAUTHORIZED, 'AUDIO_UNAUTHORIZED');
    });
    let authed = false;
    let gotFirst = false;
    const first = await new Promise<string | undefined>((resolve) => {
      ws.on('message', (data, isBinary) => {
        if (authed) return;
        // A second frame while the token is still being checked is audio before auth.
        if (gotFirst) return end(AUDIO_CLOSE_CODES.AUDIO_UNAUTHORIZED, 'AUDIO_UNAUTHORIZED');
        gotFirst = true;
        if (isBinary) return resolve(undefined);
        resolve(Array.isArray(data) ? Buffer.concat(data).toString('utf8') : data.toString('utf8'));
      });
      ws.once('close', () => resolve(undefined));
    });
    const token = parseAuth(first);
    if (ended) return;
    if (token === undefined) {
      end(AUDIO_CLOSE_CODES.AUDIO_UNAUTHORIZED, 'AUDIO_UNAUTHORIZED');
      return;
    }
    let payload: TokenPayload;
    try {
      const auth = await authenticate(auctionId, token);
      if (ended) return;
      if (!auth.ok) {
        if (auth.status === 404) end(4404, 'not_found');
        else end(AUDIO_CLOSE_CODES.AUDIO_UNAUTHORIZED, 'AUDIO_UNAUTHORIZED');
        return;
      }
      payload = auth.payload;
    } catch {
      end(1011, 'internal');
      return;
    }
    timers[2]?.();
    timers[2] = undefined;
    authed = true;

    pending = { token, roomId: auctionId, role: 'auctioneer' };
    const opened = session.open({ roomId: auctionId, source }, token);
    pending = undefined;
    if (!opened.ok) {
      end(AUDIO_CLOSE_CODES[opened.error], opened.error);
      return;
    }
    const stream = opened.stream;
    held.stream = stream;
    // Tells the client it may start sending audio; frames sent before this are refused.
    ws.send(JSON.stringify({ t: 'ready' }));

    ws.on('message', (data, isBinary) => {
      if (ended) return;
      const frame: unknown = isBinary ? (Array.isArray(data) ? Buffer.concat(data) : data) : 'text';
      const res = stream.accept(frame);
      if (!res.ok) {
        end(AUDIO_CLOSE_CODES[res.error], res.error);
        return;
      }
      if (bridge === undefined) return;
      try {
        bridge.write(decodeBatch(new Uint8Array(frame as ArrayBuffer | Buffer)));
      } catch {
        end(AUDIO_CLOSE_CODES.AUDIO_BAD_FRAME, 'AUDIO_BAD_FRAME');
      }
    });

    try {
      const room = await opts.service.room(auctionId as AuctionId);
      if (ended) return;
      bridge = startVoiceBridge({
        auctionId: auctionId as AuctionId,
        room,
        stt: opts.makeStt(),
        clock: opts.clock,
        onFeed: (msg) => {
          if (!ended && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
        },
        ...(opts.log !== undefined ? { log: opts.log } : {}),
      });
    } catch {
      end(1011, 'internal');
      return;
    }

    const stopAt = Math.min(stream.expiresAtMs, payload.exp * 1000);
    timers[0] = opts.clock.setTimer(stopAt, () => {
      end(AUDIO_CLOSE_CODES.AUDIO_SESSION_LIMIT, 'AUDIO_SESSION_LIMIT');
    });
    const tokenFacts = { jti: payload.jti, iat: payload.iat, exp: payload.exp, kind: payload.kind };
    const check = (): void => {
      connectionTokenLive(opts.store, auctionId, tokenFacts, opts.clock.now())
        .then((live) => {
          if (ended) return;
          if (!live) end(AUDIO_CLOSE_CODES.AUDIO_UNAUTHORIZED, 'AUDIO_UNAUTHORIZED');
          else timers[1] = opts.clock.setTimer(opts.clock.now() + LIVENESS_MS, check);
        })
        .catch(() => end(1011, 'internal'));
    };
    timers[1] = opts.clock.setTimer(opts.clock.now() + LIVENESS_MS, check);
  }

  return {
    close() {
      opts.server.off('upgrade', onUpgrade);
      for (const ws of sockets) {
        ws.close(1001, 'going_away');
        setTimeout(() => ws.terminate(), 1000).unref();
      }
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
}
