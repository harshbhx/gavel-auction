import { z } from 'zod';
import { GavelError, type ErrorCode } from '../errors';

export const PROTOCOL_VERSION = 1 as const;
/** Largest frame a client may send, in bytes (R-RT-014). */
export const MAX_FRAME_BYTES = 16 * 1024;
/** Largest frame the server may send: a full snapshot or hammer ranking must fit. */
export const MAX_SERVER_FRAME_BYTES = 256 * 1024;
/** Room-size limits shared by the schemas and the server config defaults. */
export const MAX_BIDDERS_PER_ROOM = 200;
export const MAX_PADDLE = 9999;
/** Bounds for free text that clients can persist or the server echoes. */
export const MAX_NAME_CHARS = 64;
export const MAX_TRANSCRIPT_CHARS = 500;
export const MAX_REASON_CHARS = 120;
export const MAX_NOTE_CHARS = 300;

/** Strict `{v:1, t, ...shape}` schema for one message type. */
export function message<T extends string, S extends z.ZodRawShape>(t: T, shape: S) {
  return z.object({ v: z.literal(PROTOCOL_VERSION), t: z.literal(t), ...shape }).strict();
}

export type FrameResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: Extract<ErrorCode, 'bad_message' | 'unsupported_version'>;
      error: GavelError;
    };

function fail<T>(code: 'bad_message' | 'unsupported_version', msg: string): FrameResult<T> {
  return { ok: false, code, error: new GavelError(code, msg) };
}

const byteLength = (raw: string | Uint8Array): number =>
  typeof raw === 'string' ? new TextEncoder().encode(raw).length : raw.length;

/**
 * Decode one frame against a table of strict per-type schemas. Never throws.
 * Oversized frames, bad JSON, non-objects, unknown `t`, extra fields and wrong
 * versions yield `bad_message`; a `join` with a version other than 1 yields
 * `unsupported_version`.
 */
export function decodeFrame<S extends Record<string, z.ZodTypeAny>>(
  raw: string | Uint8Array,
  schemas: S,
  maxBytes: number = MAX_FRAME_BYTES,
): FrameResult<z.infer<S[keyof S]>> {
  if (byteLength(raw) > maxBytes) return fail('bad_message', 'frame too large');
  let json: unknown;
  try {
    json = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
  } catch {
    return fail('bad_message', 'invalid json');
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return fail('bad_message', 'frame must be an object');
  }
  const { v, t } = json as { v?: unknown; t?: unknown };
  if (typeof t !== 'string' || !Object.prototype.hasOwnProperty.call(schemas, t)) {
    return fail('bad_message', 'unknown message type');
  }
  if (v !== PROTOCOL_VERSION) {
    return t === 'join'
      ? fail('unsupported_version', 'unsupported protocol version')
      : fail('bad_message', 'bad protocol version');
  }
  const schema = schemas[t];
  const parsed = schema?.safeParse(json);
  if (!parsed?.success) return fail('bad_message', 'invalid message');
  return { ok: true, value: parsed.data as z.infer<S[keyof S]> };
}
