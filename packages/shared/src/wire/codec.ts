import { z } from 'zod';
import { GavelError } from '../errors';
import { clientSchemas } from './client';
import { MAX_FRAME_BYTES, decodeFrame } from './envelope';
import { serverSchemas, type ServerMsg } from './server';
import type { ClientMsg } from './client';

export type WireMsg = ClientMsg | ServerMsg;

export type CodecResult<T> = { ok: true; value: T } | { ok: false; error: GavelError };

const allSchemas: Record<string, z.ZodTypeAny> = { ...clientSchemas, ...serverSchemas };

/** Validate and serialise one message. Never throws. */
export function encodeMsg(msg: unknown): CodecResult<string> {
  try {
    if (typeof msg !== 'object' || msg === null) {
      return { ok: false, error: new GavelError('bad_message', 'message must be an object') };
    }
    const { t } = msg as { t?: unknown };
    const schema =
      typeof t === 'string' && Object.prototype.hasOwnProperty.call(allSchemas, t)
        ? allSchemas[t]
        : undefined;
    if (!schema) return { ok: false, error: new GavelError('bad_message', 'unknown message type') };
    const parsed = schema.safeParse(msg);
    if (!parsed.success) {
      return { ok: false, error: new GavelError('bad_message', 'invalid message') };
    }
    const text = JSON.stringify(parsed.data);
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_FRAME_BYTES) {
      return { ok: false, error: new GavelError('bad_message', 'frame too large') };
    }
    return { ok: true, value: text };
  } catch {
    return { ok: false, error: new GavelError('bad_message', 'unencodable message') };
  }
}

/** Parse one frame of either direction. Never throws. */
export function decodeMsg(raw: unknown): CodecResult<WireMsg> {
  try {
    if (typeof raw !== 'string' && !(raw instanceof Uint8Array)) {
      return { ok: false, error: new GavelError('bad_message', 'frame must be text or bytes') };
    }
    const res = decodeFrame(raw, allSchemas);
    if (res.ok) return { ok: true, value: res.value as WireMsg };
    return { ok: false, error: res.error };
  } catch {
    return { ok: false, error: new GavelError('bad_message', 'undecodable frame') };
  }
}
