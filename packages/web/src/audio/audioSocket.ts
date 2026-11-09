/** The /audio WebSocket from the browser: auth message, ready, binary audio, caption and status feed. */

/** Why the socket ended, in the words the console picks a message for. */
export type AudioProblem =
  | 'unauthorized' // 4401: the token was refused (expired, wrong room, or a room that never uses speech services)
  | 'badFrame' // 1008: the server could not read a message
  | 'rate' // 4429: too much audio too fast, or the host refused the upgrade
  | 'ended' // 4408: the session time limit, or another tab took over the stream
  | 'streamBusy' // 4409: another stream already holds the slot
  | 'notFound' // 4404: no such room
  | 'server' // 1011 and other server errors
  | 'lost'; // the connection dropped or never opened

/** What the host sends besides the ready message. Unknown types are ignored. */
export type AudioFeed =
  | { t: 'caption'; text: string; final: boolean }
  | { t: 'status'; stt: 'ok' | 'degraded' | 'down'; llm: 'ok' | 'down' | 'off' }
  | { t: 'confirm_expired'; promptId: string };

export interface AudioSocketHandlers {
  onReady(): void;
  onFeed(msg: AudioFeed): void;
  /** Called once, after the socket is gone. Null when this side closed it. */
  onClose(problem: AudioProblem | null): void;
}

export interface AudioSocket {
  /** Sends one binary message. Returns false when it was dropped (not ready, or the socket is backed up). */
  send(bytes: Uint8Array): boolean;
  close(): void;
  readonly ready: boolean;
}

const WS_CONNECTING = 0;
const WS_OPEN = 1;

/** More than this waiting in the socket means the link cannot keep up: drop, do not queue. */
export const MAX_BUFFERED_BYTES = 64 * 1024;

export function problemForClose(code: number): AudioProblem {
  switch (code) {
    case 4401:
      return 'unauthorized';
    case 1008:
      return 'badFrame';
    case 4429:
      return 'rate';
    case 4408:
      return 'ended';
    case 4409:
      return 'streamBusy';
    case 4404:
      return 'notFound';
    case 1011:
    case 1013:
      return 'server';
    default:
      return 'lost';
  }
}

/** `http(s)://host` to `ws(s)://host/audio?auction=...&source=mic`. The token is never in the URL. */
export function audioSocketUrl(apiBase: string, auctionId: string): string {
  const base = apiBase.replace(/\/+$/, '').replace(/^http/, 'ws');
  return `${base}/audio?auction=${encodeURIComponent(auctionId)}&source=mic`;
}

function parseFeed(data: unknown): { ready: true } | { feed: AudioFeed } | null {
  if (typeof data !== 'string') return null;
  let v: unknown;
  try {
    v = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const m = v as Record<string, unknown>;
  if (m['t'] === 'ready') return { ready: true };
  if (m['t'] === 'caption' && typeof m['text'] === 'string' && typeof m['final'] === 'boolean') {
    return { feed: { t: 'caption', text: m['text'], final: m['final'] } };
  }
  if (
    m['t'] === 'status' &&
    (m['stt'] === 'ok' || m['stt'] === 'degraded' || m['stt'] === 'down')
  ) {
    const llm = m['llm'] === 'ok' || m['llm'] === 'down' ? m['llm'] : 'off';
    return { feed: { t: 'status', stt: m['stt'], llm } };
  }
  if (m['t'] === 'confirm_expired' && typeof m['promptId'] === 'string') {
    return { feed: { t: 'confirm_expired', promptId: m['promptId'] } };
  }
  return null;
}

/**
 * Opens the socket and sends the auth message first (the server closes any socket whose first
 * message is anything else, within 5 s). Audio goes out only after the server says ready.
 */
export function openAudioSocket(
  url: string,
  token: string,
  handlers: AudioSocketHandlers,
): AudioSocket {
  let ready = false;
  let closedByUs = false;
  let done = false;
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  const finish = (problem: AudioProblem | null): void => {
    if (done) return;
    done = true;
    ready = false;
    handlers.onClose(problem);
  };
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 'auth', token }));
  };
  ws.onmessage = (ev: MessageEvent<unknown>) => {
    const got = parseFeed(ev.data);
    if (got === null) return;
    if ('ready' in got) {
      if (ready) return;
      ready = true;
      handlers.onReady();
      return;
    }
    handlers.onFeed(got.feed);
  };
  ws.onerror = () => undefined;
  ws.onclose = (ev: CloseEvent) => {
    finish(closedByUs ? null : problemForClose(ev.code));
  };
  return {
    get ready() {
      return ready;
    },
    send(bytes) {
      if (!ready || ws.readyState !== WS_OPEN) return false;
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) return false;
      ws.send(bytes);
      return true;
    },
    close() {
      closedByUs = true;
      ready = false;
      if (ws.readyState === WS_OPEN || ws.readyState === WS_CONNECTING) {
        ws.close(1000, 'done');
      }
      finish(null);
    },
  };
}
