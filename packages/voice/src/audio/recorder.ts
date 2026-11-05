import { encodeWav } from './wav.js';

export const SAMPLE_RATE = 16000;
export const MAX_RING_MS = 5000;
const MAX_RING_SAMPLES = (SAMPLE_RATE * MAX_RING_MS) / 1000;

/** In-memory ring of PCM samples holding at most 5 s. Never touches disk or a database. */
export class AudioRingBuffer {
  private readonly buf: Int16Array;
  private head = 0;
  private count = 0;

  constructor(capacityMs: number = MAX_RING_MS) {
    const samples = Math.floor((SAMPLE_RATE * Math.min(capacityMs, MAX_RING_MS)) / 1000);
    this.buf = new Int16Array(Math.max(1, Math.min(samples, MAX_RING_SAMPLES)));
  }

  push(pcm: Int16Array): void {
    const cap = this.buf.length;
    const start = Math.max(0, pcm.length - cap);
    for (let i = start; i < pcm.length; i++) {
      this.buf[this.head] = pcm[i] ?? 0;
      this.head = (this.head + 1) % cap;
    }
    this.count = Math.min(cap, this.count + pcm.length);
  }

  get durationMs(): number {
    return (this.count * 1000) / SAMPLE_RATE;
  }

  /** Oldest to newest copy of the buffered samples. */
  snapshot(): Int16Array {
    const cap = this.buf.length;
    const out = new Int16Array(this.count);
    const first = (this.head - this.count + cap) % cap;
    for (let i = 0; i < this.count; i++) out[i] = this.buf[(first + i) % cap] ?? 0;
    return out;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}

export type RecorderRefusal = 'not_opted_in' | 'path_inside_repo' | 'not_started';

export class RecorderRefusedError extends Error {
  constructor(readonly code: RecorderRefusal) {
    super(`recorder refused: ${code}`);
    this.name = 'RecorderRefusedError';
  }
}

export interface OptInRecorderOptions {
  env: Readonly<Record<string, string | undefined>>;
  /** Local directory for fixtures; must be outside the repo. */
  outDir: string;
  repoRoot: string;
  /** Shows or hides the on-screen recording indicator. */
  setIndicator: (on: boolean) => void;
  /** Injected file writer; the default pipeline never supplies one. */
  write: (path: string, data: Uint8Array) => void;
  nowMs: () => number;
}

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isInside(child: string, parent: string): boolean {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(`${p}/`);
}

/** Fixture recorder. Refuses unless VOICE_RECORD=1, an indicator is wired, and the path is outside the repo. */
export class OptInRecorder {
  private readonly chunks: Int16Array[] = [];
  private active = false;

  constructor(private readonly opts: OptInRecorderOptions) {}

  get recording(): boolean {
    return this.active;
  }

  start(): void {
    if (this.opts.env['VOICE_RECORD'] !== '1') throw new RecorderRefusedError('not_opted_in');
    if (isInside(this.opts.outDir, this.opts.repoRoot)) {
      throw new RecorderRefusedError('path_inside_repo');
    }
    this.chunks.length = 0;
    this.active = true;
    this.opts.setIndicator(true);
  }

  push(pcm: Int16Array): void {
    if (!this.active) throw new RecorderRefusedError('not_started');
    this.chunks.push(pcm.slice());
  }

  /** Writes one WAV file and returns its path. */
  stop(name: string): string {
    if (!this.active) throw new RecorderRefusedError('not_started');
    this.active = false;
    this.opts.setIndicator(false);
    let total = 0;
    for (const c of this.chunks) total += c.length;
    const all = new Int16Array(total);
    let at = 0;
    for (const c of this.chunks) {
      all.set(c, at);
      at += c.length;
    }
    this.chunks.length = 0;
    const safe = name.replace(/[^A-Za-z0-9_-]/g, '_');
    const path = `${this.opts.outDir.replace(/[\\/]+$/, '')}/${safe}-${this.opts.nowMs()}.wav`;
    this.opts.write(path, encodeWav(all));
    return path;
  }
}
