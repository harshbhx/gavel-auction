import { z } from 'zod';
import { GavelError } from '../errors';
import { clientSchemas } from './client';
import { MAX_FRAME_BYTES, MAX_SERVER_FRAME_BYTES, decodeFrame } from './envelope';
import { serverSchemas, type ServerMsg } from './server';
import type { ClientMsg } from './client';

export type WireMsg = ClientMsg | ServerMsg;

export type CodecResult<T> = { ok: true; value: T } | { ok: false; error: GavelError };

const allSchemas: Record<string, z.ZodTypeAny> = { ...clientSchemas, ...serverSchemas };

/** Which side is sending: it picks the schema table and the frame cap. */
export type Direction = 'client' | 'server';

const isClientType = (t: string): boolean => Object.prototype.hasOwnProperty.call(clientSchemas, t);

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
    // Client frames keep the 16 KiB cap; server frames (snapshots, hammer) get a larger one.
    const cap = typeof t === 'string' && isClientType(t) ? MAX_FRAME_BYTES : MAX_SERVER_FRAME_BYTES;
    const parsed = schema.safeParse(msg);
    if (!parsed.success) {
      return { ok: false, error: new GavelError('bad_message', 'invalid message') };
    }
    const text = JSON.stringify(parsed.data);
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > cap) {
      return { ok: false, error: new GavelError('bad_message', 'frame too large') };
    }
    return { ok: true, value: text };
  } catch {
    return { ok: false, error: new GavelError('bad_message', 'unencodable message') };
  }
}

/**
 * Parse one frame sent by `from`. A server host passes `'client'` for inbound
 * sockets, so server-only frames such as `price` or `hammer` are refused
 * (R-RT-015); a client passes `'server'`. Never throws.
 */
export function decodeMsg(raw: unknown, from: Direction): CodecResult<WireMsg> {
  try {
    if (typeof raw !== 'string' && !(raw instanceof Uint8Array)) {
      return { ok: false, error: new GavelError('bad_message', 'frame must be text or bytes') };
    }
    const res =
      from === 'client'
        ? decodeFrame(raw, clientSchemas, MAX_FRAME_BYTES)
        : decodeFrame(raw, serverSchemas, MAX_SERVER_FRAME_BYTES);
    if (res.ok) return { ok: true, value: res.value as WireMsg };
    return { ok: false, error: res.error };
  } catch {
    return { ok: false, error: new GavelError('bad_message', 'undecodable frame') };
  }
}
