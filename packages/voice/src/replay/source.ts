import { FLAG_END_OF_STREAM, FRAME_SAMPLES, MAX_FRAMES, type AudioBatch } from '../audio/frame.js';

const SAMPLE_RATE = 16000;
const BATCH_FRAMES = 5;
const BATCH_MS = (BATCH_FRAMES * FRAME_SAMPLES * 1000) / SAMPLE_RATE;

export type ReplaySpeed = 1 | 4;

/** Timer source; VirtualClock satisfies it. */
export interface ReplayClock {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** Anything that produces framed audio batches, live or recorded. */
export interface AudioSource {
  start(sink: (batch: AudioBatch) => void): Promise<void>;
  stop(): void;
}

export class WavError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavError';
  }
}

function tag(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);
}

/** Read a 16 kHz mono 16-bit PCM WAV; anything else is rejected. */
export function readWav(bytes: Uint8Array): Int16Array {
  if (bytes.length < 12 || tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'WAVE') {
    throw new WavError('not a RIFF/WAVE file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmtOk = false;
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = tag(bytes, pos);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length) throw new WavError('short fmt chunk');
      const format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const rate = view.getUint32(body + 4, true);
      const bits = view.getUint16(body + 14, true);
      if (format !== 1 || channels !== 1 || rate !== SAMPLE_RATE || bits !== 16) {
        throw new WavError('expected 16 kHz mono 16-bit PCM');
      }
      fmtOk = true;
    } else if (id === 'data') {
      if (!fmtOk) throw new WavError('data chunk before fmt chunk');
      const len = Math.min(size, bytes.length - body) & ~1;
      const pcm = new Int16Array(len / 2);
      for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(body + i * 2, true);
      return pcm;
    }
    pos = body + size + (size % 2);
  }
  throw new WavError('no data chunk');
}

/** Cut PCM into 100 ms batches of whole frames; the last is zero padded and flagged end of stream. */
export function frameBatches(pcm: Int16Array): AudioBatch[] {
  const per = BATCH_FRAMES * FRAME_SAMPLES;
  const total = Math.max(1, Math.ceil(pcm.length / per));
  const out: AudioBatch[] = [];
  for (let i = 0; i < total; i++) {
    const slice = pcm.subarray(i * per, (i + 1) * per);
    const frames = Math.min(MAX_FRAMES, Math.max(1, Math.ceil(slice.length / FRAME_SAMPLES)));
    const chunk = new Int16Array(frames * FRAME_SAMPLES);
    chunk.set(slice);
    out.push({
      seq: i,
      tsMs: i * BATCH_MS,
      flags: i === total - 1 ? FLAG_END_OF_STREAM : 0,
      pcm: chunk,
    });
  }
  return out;
}

export interface ReplaySourceOptions {
  wav: Uint8Array;
  clock: ReplayClock;
  speed?: ReplaySpeed;
}

/** Feeds a recorded WAV through the same batch framing as live audio, at 1x or 4x (R-VOX-081). */
export class ReplaySource implements AudioSource {
  private readonly batches: AudioBatch[];
  private readonly clock: ReplayClock;
  private readonly stepMs: number;
  private timer: number | null = null;
  private done: (() => void) | null = null;
  private started = false;

  constructor(opts: ReplaySourceOptions) {
    this.batches = frameBatches(readWav(opts.wav));
    this.clock = opts.clock;
    this.stepMs = BATCH_MS / (opts.speed ?? 1);
  }

  /** Total audio duration in milliseconds. */
  get durationMs(): number {
    return this.batches.length * BATCH_MS;
  }

  /**
   * Delivers batch k once its audio has elapsed (k+1 steps), so the stream ends after
   * duration / speed. Resolves after the end-of-stream batch or when stop() is called.
   */
  start(sink: (batch: AudioBatch) => void): Promise<void> {
    if (this.started) return Promise.resolve();
    this.started = true;
    return new Promise<void>((resolve) => {
      this.done = resolve;
      let i = 0;
      const tick = (): void => {
        const b = this.batches[i];
        if (!b) {
          this.finish();
          return;
        }
        i += 1;
        sink(b);
        if (i >= this.batches.length) this.finish();
        else this.timer = this.clock.setTimeout(tick, this.stepMs);
      };
      this.timer = this.clock.setTimeout(tick, this.stepMs);
    });
  }

  stop(): void {
    this.finish();
  }

  private finish(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    const d = this.done;
    this.done = null;
    d?.();
  }
}
