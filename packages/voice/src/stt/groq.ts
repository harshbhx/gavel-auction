import { Endpointer } from '../audio/endpointer.js';
import { encodeWav } from '../audio/wav.js';
import {
  FLAG_DISCONTINUITY,
  FLAG_END_OF_STREAM,
  FLAG_END_OF_UTTERANCE,
  FLAG_KEEPALIVE,
  type AudioBatch,
} from '../audio/frame.js';
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
/**
 * Vocabulary hint sent with every request: bid words only, no amounts, so a silent or noisy chunk
 * cannot come back as a made-up bid. Chosen in the G5 option trials (docs/GATES.md).
 */
export const GROQ_BID_PROMPT =
  'Auction bidding. Words heard: paddle, bidder number, dollars, hundred, thousand.';
/** Confidence used when the response carries no log probability. */
export const GROQ_FALLBACK_CONFIDENCE = 0.5;
const MAX_PENDING_CHUNKS = 8;
/** Per-request deadline; a hung request must not stall the drain loop. */
export const GROQ_REQUEST_TIMEOUT_MS = 4000;
export const GROQ_STOP_DEADLINE_MS = 8000;
/** A chunk that failed with a retryable error is tried again this many times at most. */
export const GROQ_MAX_RETRIES = 2;
/** Retries stop once the chunk is older than this, since late speech is only asked about. */
export const GROQ_RETRY_WINDOW_MS = 5000;
export const GROQ_RETRY_BACKOFF_MS = 150;

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: FormData;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface GroqSttOptions {
  /** Read from the server environment only; never logged. */
  apiKey: string;
  fetch: FetchLike;
  model?: string;
  /** Vocabulary hint; null sends none. Defaults to GROQ_BID_PROMPT. */
  prompt?: string | null;
  endpoint?: string;
  /** Milliseconds clock used for latency; defaults to Date.now. */
  now?: () => number;
  maxPendingChunks?: number;
  requestTimeoutMs?: number;
  stopDeadlineMs?: number;
  /** Base delay before a retry; grows with each attempt. */
  retryBackoffMs?: number;
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
  attempts?: number;
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
  /** Capture-timeline end of the audio seen so far, from batch timestamps. */
  private clockMs = 0;
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
      if ((batch.flags & FLAG_KEEPALIVE) !== 0) {
        this.clockMs = Math.max(this.clockMs, batch.tsMs);
        // Key released or muted: no more frames will arrive, so close the held chunk now (R12-V06).
        if ((batch.flags & FLAG_END_OF_UTTERANCE) !== 0) {
          this.enqueueChunks(this.endpointer.flush());
        }
        return;
      }
      // Audio before a gap is cut at the gap, never joined to the audio after it (R7-11).
      if ((batch.flags & FLAG_DISCONTINUITY) !== 0) this.enqueueChunks(this.endpointer.flush());
      const endMs = batch.tsMs + Math.round((batch.pcm.length * 1000) / SAMPLE_RATE);
      this.enqueueChunks(this.endpointer.push(batch), endMs);
      this.clockMs = Math.max(this.clockMs, endMs);
      if ((batch.flags & FLAG_END_OF_STREAM) !== 0) {
        this.enqueueChunks(this.endpointer.flush());
        this.emit({ type: 'utterance_end', atMs: this.clockMs });
      }
    } catch {
      this.stats.addDropped();
    }
  }

  /** Queue chunks ending at `endMs` (default: the end of the audio seen so far). */
  private enqueueChunks(chunks: readonly { pcm: Int16Array }[], endMs = this.clockMs): void {
    for (const chunk of chunks) {
      const durMs = Math.round((chunk.pcm.length * 1000) / SAMPLE_RATE);
      this.enqueue({
        pcm: chunk.pcm,
        startMs: Math.max(0, endMs - durMs),
        endMs,
        readyAt: this.now(),
      });
    }
  }

  events(): AsyncIterable<SttEvent> {
    return this.channel.iterable();
  }

  async stop(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.open = false;
    // Speech still held by the endpointer and chunks still queued are sent before closing (R7-06).
    try {
      this.enqueueChunks(this.endpointer.flush());
    } catch {
      this.stats.addDropped();
    }
    // A stuck request is bounded by its own timeout; this deadline is the last resort.
    const deadlineMs = this.opts.stopDeadlineMs ?? GROQ_STOP_DEADLINE_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, deadlineMs);
    });
    while (this.running) {
      const ran = this.running;
      const hit = await Promise.race([ran.then(() => false), deadline.then(() => true)]);
      if (hit) {
        this.pending.length = 0;
        break;
      }
    }
    if (timer !== undefined) clearTimeout(timer);
    this.emit({ type: 'state', state: 'closed' });
    this.channel.close();
  }

  private enqueue(chunk: PendingChunk): void {
    const max = this.opts.maxPendingChunks ?? MAX_PENDING_CHUNKS;
    // On overflow the newest chunk is the one refused: the oldest holds the earliest bid of a burst.
    if (this.pending.length >= max) this.stats.addDropped();
    else this.pending.push(chunk);
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
      const retry = await this.transcribe(chunk);
      if (retry) {
        const attempts = (chunk.attempts ?? 0) + 1;
        const fresh = this.now() - chunk.readyAt <= GROQ_RETRY_WINDOW_MS;
        if (attempts <= GROQ_MAX_RETRIES && fresh) {
          const base = this.opts.retryBackoffMs ?? GROQ_RETRY_BACKOFF_MS;
          await new Promise<void>((resolve) => setTimeout(resolve, base * attempts));
          // Back at the head: it is the oldest audio, so order is kept.
          this.pending.unshift({ ...chunk, attempts });
        } else {
          this.stats.addDropped();
        }
      }
    }
  }

  /** Resolves true when the chunk failed with an error that is worth retrying. */
  private async transcribe(chunk: PendingChunk): Promise<boolean> {
    const form = new FormData();
    const wav = encodeWav(chunk.pcm);
    form.append('file', new Blob([wav.slice().buffer], { type: 'audio/wav' }), 'chunk.wav');
    form.append('model', this.opts.model ?? GROQ_DEFAULT_MODEL);
    form.append('response_format', 'verbose_json');
    form.append('language', 'en');
    form.append('temperature', '0');
    const prompt = this.opts.prompt === undefined ? GROQ_BID_PROMPT : this.opts.prompt;
    if (prompt !== null) form.append('prompt', prompt);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve('timeout');
      }, this.opts.requestTimeoutMs ?? GROQ_REQUEST_TIMEOUT_MS);
    });
    try {
      const outcome = await Promise.race([this.request(form, controller.signal), timedOut]);
      if (outcome === 'timeout') {
        this.emit({ type: 'error', code: 'timeout', retryable: true });
        return true;
      }
      const res = outcome.res;
      if (!res.ok) {
        const { code, retryable } = classifyHttpStatus(res.status);
        this.emit({ type: 'error', code, retryable });
        return retryable;
      }
      const parsed = parseResponse(outcome.body);
      if (!parsed) {
        this.emit({ type: 'error', code: 'unknown', retryable: true });
        return true;
      }
      if (parsed.text === '') return false;
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
      return false;
    } catch {
      const code = controller.signal.aborted ? 'timeout' : 'closed';
      this.emit({ type: 'error', code, retryable: true });
      return true;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async request(
    form: FormData,
    signal: AbortSignal,
  ): Promise<{ res: { ok: boolean; status: number }; body: unknown }> {
    const res = await this.opts.fetch(this.opts.endpoint ?? GROQ_DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.opts.apiKey}` },
      body: form,
      signal,
    });
    const body = res.ok ? await res.json() : null;
    return { res, body };
  }

  private emit(event: SttEvent, latencyMs?: number): void {
    this.stats.observe(event, latencyMs);
    this.channel.push(event);
  }
}
