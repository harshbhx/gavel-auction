/**
 * Voice half of the /audio WebSocket (R-VOX-097). The server mounts the route and
 * feeds this adapter; it holds no socket and no timers, and reads time only from
 * the injected clock, so every limit is testable with a fake clock.
 */

export const AUDIO_ERROR_CODES = [
  'AUDIO_UNAUTHORIZED',
  'AUDIO_BAD_FRAME',
  'AUDIO_RATE_LIMIT',
  'AUDIO_SESSION_LIMIT',
  'AUDIO_STREAM_BUSY',
] as const;
export type AudioErrorCode = (typeof AUDIO_ERROR_CODES)[number];

export const AUDIO_MAX_BYTES_PER_SEC = 64 * 1024;
export const AUDIO_MAX_SESSION_MS = 30 * 60 * 1000;
const RATE_WINDOW_MS = 1000;

export interface VoiceSessionDeps {
  /** Epoch ms from the room clock. */
  now: () => number;
  /** The same check the join message uses; true when the token is valid for the room. */
  verifyToken: (token: string, roomId: string) => boolean;
  maxBytesPerSec?: number;
  maxSessionMs?: number;
}

export interface StreamKey {
  roomId: string;
  /** Audio source, for example a microphone id. */
  source: string;
}

export type OpenResult = { ok: true; stream: AudioStream } | { ok: false; error: AudioErrorCode };

export type FrameResult =
  | { ok: true; bytes: number }
  | { ok: false; error: AudioErrorCode; closed: true };

export interface AudioStream {
  /** Offer one websocket message. Anything that is not a binary frame is a violation. */
  accept(frame: unknown): FrameResult;
  /** Epoch ms at which the session cap closes the stream. */
  readonly expiresAtMs: number;
  /** Release the (room, source) slot. Safe to call twice. */
  close(): void;
}

export interface VoiceSession {
  open(key: StreamKey, token: string | null | undefined): OpenResult;
  /** Number of streams currently open. */
  activeStreams(): number;
}

function frameBytes(frame: unknown): number | null {
  if (frame instanceof ArrayBuffer) return frame.byteLength;
  if (ArrayBuffer.isView(frame)) return frame.byteLength;
  return null;
}

export function createVoiceSession(deps: VoiceSessionDeps): VoiceSession {
  const maxRate = deps.maxBytesPerSec ?? AUDIO_MAX_BYTES_PER_SEC;
  const maxSession = deps.maxSessionMs ?? AUDIO_MAX_SESSION_MS;
  const active = new Set<string>();

  function slot(key: StreamKey): string {
    return `${encodeURIComponent(key.roomId)}:${encodeURIComponent(key.source)}`;
  }

  return {
    activeStreams: () => active.size,
    open(key, token) {
      if (typeof token !== 'string' || token === '' || !deps.verifyToken(token, key.roomId)) {
        return { ok: false, error: 'AUDIO_UNAUTHORIZED' };
      }
      const id = slot(key);
      if (active.has(id)) return { ok: false, error: 'AUDIO_STREAM_BUSY' };
      active.add(id);

      const startedAt = deps.now();
      const recent: Array<{ at: number; bytes: number }> = [];
      let open = true;

      const close = (): void => {
        if (!open) return;
        open = false;
        active.delete(id);
      };
      const fail = (error: AudioErrorCode): FrameResult => {
        close();
        return { ok: false, error, closed: true };
      };

      const stream: AudioStream = {
        expiresAtMs: startedAt + maxSession,
        close,
        accept(frame) {
          if (!open) return { ok: false, error: 'AUDIO_BAD_FRAME', closed: true };
          const at = deps.now();
          if (at - startedAt >= maxSession) return fail('AUDIO_SESSION_LIMIT');
          const bytes = frameBytes(frame);
          if (bytes === null || bytes === 0) return fail('AUDIO_BAD_FRAME');
          while (recent.length > 0 && at - (recent[0]?.at ?? at) >= RATE_WINDOW_MS) recent.shift();
          const inWindow = recent.reduce((sum, r) => sum + r.bytes, 0);
          if (inWindow + bytes > maxRate) return fail('AUDIO_RATE_LIMIT');
          recent.push({ at, bytes });
          return { ok: true, bytes };
        },
      };
      return { ok: true, stream };
    },
  };
}
