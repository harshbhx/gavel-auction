/**
 * Binary audio message codec (SPEC-voice section 5), little endian.
 *  byte 0 magic 0x56, byte 1 version 1, byte 2 flags, byte 3 reserved 0,
 *  bytes 4-7 seq u32, bytes 8-11 tsMs u32, then N * 640 bytes of Int16 LE PCM (N = 1..10).
 * A keepalive message (flag bit1) carries no payload.
 */
export const FRAME_SAMPLES = 320;
export const FRAME_BYTES = 640;
export const HEADER_BYTES = 12;
export const MAX_FRAMES = 10;
export const MAGIC = 0x56;
export const VERSION = 1;

export const FLAG_DISCONTINUITY = 1;
export const FLAG_KEEPALIVE = 2;
export const FLAG_END_OF_STREAM = 4;

export interface AudioBatch {
  seq: number;
  tsMs: number;
  flags: number;
  pcm: Int16Array;
}

export type VoiceFrameErrorCode = 'bad_length' | 'bad_magic' | 'bad_version';

export class VoiceFrameError extends Error {
  readonly code: VoiceFrameErrorCode;
  constructor(code: VoiceFrameErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'VoiceFrameError';
    this.code = code;
  }
}

function checkPayload(bytes: number, flags: number): void {
  if ((flags & FLAG_KEEPALIVE) !== 0) {
    if (bytes !== 0) throw new VoiceFrameError('bad_length', 'keepalive carries no payload');
    return;
  }
  const frames = bytes / FRAME_BYTES;
  if (!Number.isInteger(frames) || frames < 1 || frames > MAX_FRAMES) {
    throw new VoiceFrameError(
      'bad_length',
      `payload of ${bytes} bytes is not 1..${MAX_FRAMES} whole frames`,
    );
  }
}

export function encodeBatch(b: AudioBatch): Uint8Array {
  const payloadBytes = b.pcm.length * 2;
  checkPayload(payloadBytes, b.flags);
  const out = new Uint8Array(HEADER_BYTES + payloadBytes);
  const view = new DataView(out.buffer);
  out[0] = MAGIC;
  out[1] = VERSION;
  out[2] = b.flags & 0xff;
  out[3] = 0;
  view.setUint32(4, b.seq >>> 0, true);
  view.setUint32(8, b.tsMs >>> 0, true);
  for (let i = 0; i < b.pcm.length; i++) view.setInt16(HEADER_BYTES + i * 2, b.pcm[i] ?? 0, true);
  return out;
}

export function decodeBatch(buf: Uint8Array): AudioBatch {
  if (buf.length < HEADER_BYTES) throw new VoiceFrameError('bad_length', 'shorter than header');
  if (buf[0] !== MAGIC) throw new VoiceFrameError('bad_magic');
  if (buf[1] !== VERSION) throw new VoiceFrameError('bad_version');
  const flags = buf[2] ?? 0;
  const payloadBytes = buf.length - HEADER_BYTES;
  checkPayload(payloadBytes, flags);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const pcm = new Int16Array(payloadBytes / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(HEADER_BYTES + i * 2, true);
  return { seq: view.getUint32(4, true), tsMs: view.getUint32(8, true), flags, pcm };
}
