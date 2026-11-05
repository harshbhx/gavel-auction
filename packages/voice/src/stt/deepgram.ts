import {
  FLAG_END_OF_STREAM,
  FLAG_END_OF_UTTERANCE,
  FLAG_KEEPALIVE,
  type AudioBatch,
} from '../audio/frame.js';
import {
  buildDeepgramUrl,
  mergeDeepgramConfig,
  realSttScheduler,
  type DeepgramConfig,
  type SttScheduler,
} from './deepgram-config.js';
import {
  EventChannel,
  SttStats,
  type InstrumentedSttProvider,
  type SttErrorCode,
  type SttEvent,
  type SttWord,
} from './provider.js';

/** Minimal WebSocket surface, so tests and the server can supply their own transport. */
export interface WsLike {
  /** Bytes queued by send() and not yet written to the network. */
  readonly bufferedAmount: number;
  send(data: string | Uint8Array): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: (() => void) | null;
}

/** `protocols` carries the credential as ['token', key]; the factory decides how to present it. */
export type WsFactory = (url: string, protocols: string[]) => WsLike;

export interface DeepgramSttOptions {
  /** Read from the server environment (DEEPGRAM_API_KEY) only; never logged. */
  apiKey: string;
  socket: WsFactory;
  config?: Partial<Omit<DeepgramConfig, 'params'>> & {
    params?: DeepgramConfig['params'];
  };
  scheduler?: SttScheduler;
}

const DEFAULT_START: { keyterms: string[]; language: 'en' } = { keyterms: [], language: 'en' };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function toMs(seconds: unknown): number {
  return Math.round(num(seconds) * 1000);
}

function parseWords(raw: unknown): SttWord[] {
  if (!Array.isArray(raw)) return [];
  const out: SttWord[] = [];
  for (const w of raw) {
    if (!isRecord(w) || typeof w['word'] !== 'string') continue;
    out.push({
      word: w['word'],
      start: num(w['start']),
      end: num(w['end']),
      confidence: num(w['confidence']),
    });
  }
  return out;
}

/** Map one vendor text message to zero or one SttEvent. Unknown or malformed messages map to null. */
export function mapDeepgramMessage(data: unknown): SttEvent | null {
  if (typeof data !== 'string') return null;
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(msg)) return null;
  if (msg['type'] === 'UtteranceEnd') {
    return { type: 'utterance_end', atMs: toMs(msg['last_word_end']) };
  }
  if (msg['type'] !== 'Results') return null;
  const channel = msg['channel'];
  const alts = isRecord(channel) ? channel['alternatives'] : undefined;
  const alt = Array.isArray(alts) ? alts[0] : undefined;
  if (!isRecord(alt) || typeof alt['transcript'] !== 'string') return null;
  const text = alt['transcript'].trim();
  if (text === '') return null;
  const startMs = toMs(msg['start']);
  if (msg['is_final'] !== true) return { type: 'interim', text, startMs };
  return {
    type: 'final',
    text,
    words: parseWords(alt['words']),
    startMs,
    endMs: toMs(num(msg['start']) + num(msg['duration'])),
    confidence: num(alt['confidence']),
    speechFinal: msg['speech_final'] === true,
  };
}

/** Close codes that retrying cannot fix. */
function classifyClose(code: number): { code: SttErrorCode; retryable: boolean } {
  if (code === 1008 || code === 4001 || code === 4003) return { code: 'auth', retryable: false };
  if (code === 4008 || code === 4009) return { code: 'timeout', retryable: true };
  return { code: 'closed', retryable: true };
}

function pcmBytes(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < pcm.length; i++) view.setInt16(i * 2, pcm[i] ?? 0, true);
  return out;
}

/** Streaming provider over a WebSocket (R-VOX-014, R-VOX-016). Vendor details are UNVERIFIED (gate G5). */
export class DeepgramStt implements InstrumentedSttProvider {
  readonly name = 'deepgram' as const;
  readonly stats = new SttStats();

  protected readonly config: DeepgramConfig;
  protected readonly scheduler: SttScheduler;
  protected readonly channel = new EventChannel<SttEvent>(1024);
  private readonly opts: DeepgramSttOptions;
  private ws: WsLike | null = null;
  private live = false;
  private started = false;
  private ended = false;
  private sentAudioSinceTick = false;
  /** Per-socket map from audio sent (vendor clock) to the capture timeline (R12-V05). */
  private sentMs = 0;
  private spans: Array<{ audioMs: number; lenMs: number; tsMs: number }> = [];
  private cancelKeepAlive: (() => void) | null = null;
  private serverClosed: (() => void) | null = null;
  protected openError: SttEvent | null = null;
  protected startOpts: { keyterms: string[]; language: 'en' } = DEFAULT_START;

  constructor(opts: DeepgramSttOptions) {
    this.opts = opts;
    this.config = mergeDeepgramConfig(opts.config);
    this.scheduler = opts.scheduler ?? realSttScheduler;
  }

  async start(opts: { keyterms: string[]; language: 'en' } = DEFAULT_START): Promise<void> {
    if (this.started || this.ended) return;
    this.started = true;
    this.startOpts = opts;
    this.emit({ type: 'state', state: 'connecting' });
    const ok = await this.connect();
    if (ok) return;
    this.finish(this.openError ?? { type: 'error', code: 'closed', retryable: true });
  }

  write(batch: AudioBatch): void {
    const ws = this.ws;
    if (!this.live || !ws) {
      // Audio during connecting or a reconnect outage is lost, and the loss is counted.
      if (this.started && !this.ended) this.stats.addDropped();
      return;
    }
    try {
      this.stats.addBytes(batch.pcm.byteLength);
      if ((batch.flags & FLAG_KEEPALIVE) !== 0) {
        // Key released or muted: the vendor never hears the trailing silence, so flush now (R12-V06).
        if ((batch.flags & FLAG_END_OF_UTTERANCE) !== 0 && this.sentMs > 0) {
          ws.send(this.config.finalizeMessage);
        }
        return;
      }
      if (ws.bufferedAmount > this.config.maxBufferedBytes) {
        this.stats.addDropped();
        return;
      }
      ws.send(pcmBytes(batch.pcm));
      this.recordSent(batch);
      this.sentAudioSinceTick = true;
      if ((batch.flags & FLAG_END_OF_STREAM) !== 0) ws.send(this.config.finalizeMessage);
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
    const wasLive = this.live;
    this.live = false;
    this.stopKeepAlive();
    const ws = this.ws;
    if (ws && wasLive) {
      await new Promise<void>((resolve) => {
        const cancel = this.scheduler.after(resolve, this.config.closeWaitMs);
        this.serverClosed = () => {
          cancel();
          resolve();
        };
        try {
          ws.send(this.config.closeStreamMessage);
        } catch {
          this.serverClosed();
        }
      });
      this.serverClosed = null;
    }
    if (ws) {
      this.detach(ws);
      try {
        ws.close();
      } catch {
        // already closed
      }
    }
    this.emit({ type: 'state', state: 'closed' });
    this.channel.close();
  }

  protected get isEnded(): boolean {
    return this.ended;
  }

  /** Subclass hook: extra query pairs for the handshake, such as keyterms. */
  protected extraParams(): ReadonlyArray<readonly [string, string]> {
    return [];
  }

  /** Open one socket and resolve true when it is open, false when it failed or timed out. */
  protected connect(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let ws: WsLike;
      try {
        ws = this.opts.socket(buildDeepgramUrl(this.config, this.extraParams()), [
          'token',
          this.opts.apiKey,
        ]);
      } catch {
        this.openError = { type: 'error', code: 'closed', retryable: true };
        resolve(false);
        return;
      }
      this.ws = ws;
      let settled = false;
      let cancelTimeout: () => void = () => undefined;
      const settle = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        cancelTimeout();
        resolve(ok);
      };
      cancelTimeout = this.scheduler.after(() => {
        this.openError = { type: 'error', code: 'timeout', retryable: true };
        this.detach(ws);
        try {
          ws.close();
        } catch {
          // already closed
        }
        settle(false);
      }, this.config.openTimeoutMs);
      ws.onopen = () => {
        this.live = true;
        this.sentMs = 0;
        this.spans = [];
        this.sentAudioSinceTick = false;
        this.startKeepAlive();
        this.emit({ type: 'state', state: 'open' });
        settle(true);
      };
      ws.onmessage = (ev) => {
        const raw = mapDeepgramMessage(ev.data);
        const event = raw ? this.toCaptureTime(raw) : null;
        // Results that arrive after CloseStream are the flush, so only a closed channel drops them.
        if (event) this.emit(event);
      };
      ws.onerror = () => {
        // The close event that follows carries the outcome.
      };
      ws.onclose = (ev) => {
        this.serverClosed?.();
        if (!settled) {
          const c = classifyClose(ev.code);
          this.openError = { type: 'error', code: c.code, retryable: c.retryable };
          settle(false);
          return;
        }
        if (this.ended || this.ws !== ws) return;
        this.live = false;
        this.stopKeepAlive();
        this.onUnexpectedClose(ev.code);
      };
    });
  }

  /** The socket closed without a stop(). Subclasses may reconnect; the default ends the stream. */
  protected onUnexpectedClose(code: number): void {
    const { code: errCode, retryable } = classifyClose(code);
    this.finish({ type: 'error', code: errCode, retryable });
  }

  /** Emit an optional last error, then state closed, and end the stream. */
  protected finish(error?: SttEvent): void {
    if (this.ended) return;
    this.ended = true;
    this.live = false;
    this.stopKeepAlive();
    if (error) this.emit(error);
    this.emit({ type: 'state', state: 'closed' });
    this.channel.close();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      this.detach(ws);
      try {
        ws.close();
      } catch {
        // already closed
      }
    }
  }

  protected emit(event: SttEvent): void {
    this.stats.observe(event);
    this.channel.push(event);
  }

  private recordSent(batch: AudioBatch): void {
    const lenMs = Math.round(batch.pcm.length / 16);
    this.spans.push({ audioMs: this.sentMs, lenMs, tsMs: batch.tsMs });
    if (this.spans.length > 4096) this.spans.splice(0, this.spans.length - 2048);
    this.sentMs += lenMs;
  }

  /** Vendor audio time (ms since this socket opened) to the capture clock of AudioBatch.tsMs. */
  private captureMs(audioMs: number, edge: 'start' | 'end' = 'start'): number {
    const spans = this.spans;
    if (spans.length === 0) return audioMs;
    let hit = spans[spans.length - 1] as (typeof spans)[number];
    if (audioMs <= (spans[0] as (typeof spans)[number]).audioMs)
      hit = spans[0] as (typeof spans)[number];
    else {
      for (const s of spans) {
        // A start on a span boundary belongs to the span that begins there; an end to the one that ends there.
        const end = s.audioMs + s.lenMs;
        if (edge === 'end' ? audioMs <= end : audioMs < end) {
          hit = s;
          break;
        }
      }
    }
    return Math.max(0, Math.round(hit.tsMs + (audioMs - hit.audioMs)));
  }

  private toCaptureTime(e: SttEvent): SttEvent {
    switch (e.type) {
      case 'interim':
        return { ...e, startMs: this.captureMs(e.startMs) };
      case 'utterance_end':
        return { ...e, atMs: this.captureMs(e.atMs, 'end') };
      case 'final':
        return {
          ...e,
          startMs: this.captureMs(e.startMs),
          endMs: this.captureMs(e.endMs, 'end'),
          words: e.words.map((w) => ({
            ...w,
            start: this.captureMs(Math.round(w.start * 1000)) / 1000,
            end: this.captureMs(Math.round(w.end * 1000), 'end') / 1000,
          })),
        };
      default:
        return e;
    }
  }

  private detach(ws: WsLike): void {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.cancelKeepAlive = this.scheduler.every(() => {
      const ws = this.ws;
      if (!this.live || !ws) return;
      if (this.sentAudioSinceTick) {
        this.sentAudioSinceTick = false;
        return;
      }
      try {
        ws.send(this.config.keepAliveMessage);
      } catch {
        // a dead socket reports itself through onclose
      }
    }, this.config.keepAliveMs);
  }

  private stopKeepAlive(): void {
    this.cancelKeepAlive?.();
    this.cancelKeepAlive = null;
  }
}
