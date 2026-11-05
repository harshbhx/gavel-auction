import { Endpointer } from '../audio/endpointer.js';
import { encodeWav } from '../audio/wav.js';
import { FLAG_END_OF_STREAM, FLAG_KEEPALIVE, type AudioBatch } from '../audio/frame.js';
import {
  EventChannel,
  SttStats,
  type InstrumentedSttProvider,
  type SttErrorCode,
  type SttEvent,
} from './provider.js';

const SAMPLE_RATE = 16000;
/** Model id and endpoint are UNVERIFIED until gate G5; both are overridable. */
export const GROQ_DEFAULT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const GROQ_DEFAULT_MODEL = 'whisper-large-v3-turbo';
/** Confidence used when the response carries no log probability. */
export const GROQ_FALLBACK_CONFIDENCE = 0.5;
const MAX_PENDING_CHUNKS = 8;

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: FormData },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface GroqSttOptions {
  /** Read from the server environment only; never logged. */
  apiKey: string;
  fetch: FetchLike;
  model?: string;
  endpoint?: string;
  /** Milliseconds clock used for latency; defaults to Date.now. */
  now?: () => number;
  maxPendingChunks?: number;
}

/** exp(avg_logprob) clamped to 0..1 and rounded to two decimals. */
export function confidenceFromLogprob(avgLogprob: number): number {
  if (!Number.isFinite(avgLogprob)) return GROQ_FALLBACK_CONFIDENCE;
  const c = Math.min(1, Math.max(0, Math.exp(avgLogprob)));
  return Math.round(c * 100) / 100;
}

/** Map an HTTP status to the shared error taxonomy (R-VOX-091). */
export function classifyHttpStatus(status: number): { code: SttErrorCode; retryable: boolean } {
  if (status === 401 || status === 403) return { code: 'auth', retryable: false };
  if (status === 429) return { code: 'rate_limited', retryable: true };
  if (status >= 500) return { code: 'unknown', retryable: true };
  return { code: 'bad_audio', retryable: false };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseResponse(body: unknown): { text: string; confidence: number } | null {
  if (!isRecord(body) || typeof body['text'] !== 'string') return null;
  const segs = body['segments'];
  let sum = 0;
  let n = 0;
  if (Array.isArray(segs)) {
    for (const s of segs) {
      if (isRecord(s) && typeof s['avg_logprob'] === 'number') {
        sum += s['avg_logprob'];
        n += 1;
      }
    }
  }
  return {
    text: body['text'].trim(),
    confidence: n > 0 ? confidenceFromLogprob(sum / n) : GROQ_FALLBACK_CONFIDENCE,
  };
}

interface PendingChunk {
  pcm: Int16Array;
  startMs: number;
  endMs: number;
  readyAt: number;
}

/** Chunked fallback provider: endpointer chunks are sent as WAV and answered with final events only. */
export class GroqStt implements InstrumentedSttProvider {
  readonly name = 'groq' as const;
  readonly stats = new SttStats();

  private readonly opts: GroqSttOptions;
  private readonly now: () => number;
  private readonly channel = new EventChannel<SttEvent>(1024);
  private readonly endpointer = new Endpointer();
  private pending: PendingChunk[] = [];
  private samples = 0;
  private running: Promise<void> | null = null;
  private open = false;
  private ended = false;

  constructor(opts: GroqSttOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  start(): Promise<void> {
    if (this.open || this.ended) return Promise.resolve();
    this.open = true;
    this.emit({ type: 'state', state: 'connecting' });
    this.emit({ type: 'state', state: 'open' });
    return Promise.resolve();
  }

  write(batch: AudioBatch): void {
    if (!this.open) return;
    try {
      this.stats.addBytes(batch.pcm.byteLength);
      if ((batch.flags & FLAG_KEEPALIVE) !== 0) return;
      this.samples += batch.pcm.length;
      const endMs = Math.round((this.samples * 1000) / SAMPLE_RATE);
      for (const chunk of this.endpointer.push(batch)) {
        const durMs = Math.round((chunk.pcm.length * 1000) / SAMPLE_RATE);
        this.enqueue({
          pcm: chunk.pcm,
          startMs: Math.max(0, endMs - durMs),
          endMs,
          readyAt: this.now(),
        });
      }
      if ((batch.flags & FLAG_END_OF_STREAM) !== 0)
        this.emit({ type: 'utterance_end', atMs: endMs });
    } catch {
      this.stats.addDropped();
    }
  }

  events(): AsyncIterable<SttEvent> {
    return this.channel.iterable();
  }

  async stop(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.open = false;
    if (this.running) await this.running;
    this.pending = [];
    this.emit({ type: 'state', state: 'closed' });
    this.channel.close();
  }

  private enqueue(chunk: PendingChunk): void {
    this.pending.push(chunk);
    const max = this.opts.maxPendingChunks ?? MAX_PENDING_CHUNKS;
    while (this.pending.length > max) {
      this.pending.shift();
      this.stats.addDropped();
    }
    if (!this.running) {
      this.running = this.drain().finally(() => {
        this.running = null;
      });
    }
  }

  private async drain(): Promise<void> {
    for (;;) {
      const chunk = this.pending.shift();
      if (!chunk) return;
      await this.transcribe(chunk);
    }
  }

  private async transcribe(chunk: PendingChunk): Promise<void> {
    const form = new FormData();
    const wav = encodeWav(chunk.pcm);
    form.append('file', new Blob([wav.slice().buffer], { type: 'audio/wav' }), 'chunk.wav');
    form.append('model', this.opts.model ?? GROQ_DEFAULT_MODEL);
    form.append('response_format', 'verbose_json');
    form.append('language', 'en');
    form.append('temperature', '0');
    try {
      const res = await this.opts.fetch(this.opts.endpoint ?? GROQ_DEFAULT_ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.opts.apiKey}` },
        body: form,
      });
      if (!res.ok) {
        const { code, retryable } = classifyHttpStatus(res.status);
        this.emit({ type: 'error', code, retryable });
        return;
      }
      const parsed = parseResponse(await res.json());
      if (!parsed) {
        this.emit({ type: 'error', code: 'unknown', retryable: true });
        return;
      }
      if (parsed.text === '') return;
      this.emit(
        {
          type: 'final',
          text: parsed.text,
          words: [],
          startMs: chunk.startMs,
          endMs: chunk.endMs,
          confidence: parsed.confidence,
          speechFinal: true,
        },
        this.now() - chunk.readyAt,
      );
    } catch {
      this.emit({ type: 'error', code: 'closed', retryable: true });
    }
  }

  private emit(event: SttEvent, latencyMs?: number): void {
    this.stats.observe(event, latencyMs);
    this.channel.push(event);
  }
}
