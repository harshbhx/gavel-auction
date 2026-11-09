/**
 * Binary audio message of the /audio socket (SPEC-voice section 5), little endian:
 * byte 0 magic 0x56, byte 1 version 1, byte 2 flags, byte 3 zero, bytes 4-7 seq (u32),
 * bytes 8-11 tsMs (u32), then 1 to 10 whole frames of 320 samples (640 bytes) of 16 bit PCM.
 * A keepalive message carries no payload. This mirrors packages/voice/src/audio/frame.ts; the
 * web package does not depend on the voice package, and a test pins the bytes.
 */
export const FRAME_SAMPLES = 320;
export const FRAME_BYTES = 640;
export const HEADER_BYTES = 12;
export const MAX_FRAMES = 10;
export const MAGIC = 0x56;
export const VERSION = 1;
/** Five frames, 100 ms of audio, per message (ten messages a second). */
export const FRAMES_PER_BATCH = 5;
export const BATCH_SAMPLES = FRAME_SAMPLES * FRAMES_PER_BATCH;

export const FLAG_DISCONTINUITY = 1;
export const FLAG_KEEPALIVE = 2;
export const FLAG_END_OF_STREAM = 4;
/** With FLAG_KEEPALIVE: the speaker stopped, so finish the held utterance now. */
export const FLAG_END_OF_UTTERANCE = 8;

export interface AudioBatch {
  seq: number;
  tsMs: number;
  flags: number;
  pcm: Int16Array;
}

/** Encodes one message. Throws on a payload that is not 1 to 10 whole frames (or a keepalive with audio). */
export function encodeBatch(batch: AudioBatch): Uint8Array {
  const bytes = batch.pcm.length * 2;
  if ((batch.flags & FLAG_KEEPALIVE) !== 0) {
    if (bytes !== 0) throw new RangeError('a keepalive carries no audio');
  } else {
    const frames = bytes / FRAME_BYTES;
    if (!Number.isInteger(frames) || frames < 1 || frames > MAX_FRAMES) {
      throw new RangeError('audio must be 1 to 10 whole frames');
    }
  }
  const out = new Uint8Array(HEADER_BYTES + bytes);
  const view = new DataView(out.buffer);
  out[0] = MAGIC;
  out[1] = VERSION;
  out[2] = batch.flags & 0xff;
  view.setUint32(4, batch.seq >>> 0, true);
  view.setUint32(8, batch.tsMs >>> 0, true);
  for (let i = 0; i < batch.pcm.length; i += 1) {
    view.setInt16(HEADER_BYTES + i * 2, batch.pcm[i] ?? 0, true);
  }
  return out;
}

/** Cuts a stream of PCM chunks into batches of exactly five frames. */
export class Batcher {
  private readonly held = new Int16Array(BATCH_SAMPLES);
  private filled = 0;

  /** Adds samples; returns every full batch (100 ms each). The rest is kept for the next call. */
  push(samples: Int16Array): Int16Array[] {
    const out: Int16Array[] = [];
    let i = 0;
    while (i < samples.length) {
      const take = Math.min(BATCH_SAMPLES - this.filled, samples.length - i);
      this.held.set(samples.subarray(i, i + take), this.filled);
      this.filled += take;
      i += take;
      if (this.filled === BATCH_SAMPLES) {
        out.push(this.held.slice());
        this.filled = 0;
      }
    }
    return out;
  }

  /** The held part as one full batch padded with silence, or null when nothing is held. */
  flush(): Int16Array | null {
    if (this.filled === 0) return null;
    this.held.fill(0, this.filled);
    this.filled = 0;
    return this.held.slice();
  }

  /** Throws the held samples away (the key was released and the stream is not live). */
  reset(): void {
    this.filled = 0;
  }

  get buffered(): number {
    return this.filled;
  }
}
