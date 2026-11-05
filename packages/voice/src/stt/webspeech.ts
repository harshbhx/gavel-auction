import type { AudioBatch } from '../audio/frame.js';
import { realSttScheduler, type SttScheduler } from './deepgram-config.js';
import {
  EventChannel,
  SttStats,
  type InstrumentedSttProvider,
  type SttErrorCode,
  type SttEvent,
  type SttState,
} from './provider.js';

/** Label shown to the user whenever this provider is active (R-VOX-021). */
export const WEBSPEECH_LABEL = 'Try-it mode, less accurate';
/** Used when the browser reports no confidence (some report 0 for every result). */
export const WEBSPEECH_FALLBACK_CONFIDENCE = 0.5;
const WAIT_FOR_END_MS = 1500;

interface RecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface RecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: RecognitionAlternative | undefined;
}
export interface RecognitionEvent {
  resultIndex: number;
  results: { readonly length: number; [index: number]: RecognitionResult | undefined };
}

/** The slice of the browser SpeechRecognition API this provider uses. Tests supply a stub. */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: RecognitionEvent) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

/** Returns a recognizer, or null where the browser has none (the provider is browser-only). */
export type RecognitionFactory = () => SpeechRecognitionLike | null;

export interface WebSpeechSttOptions {
  recognition: RecognitionFactory;
  /** Milliseconds clock; event times are relative to start(). */
  now: () => number;
  scheduler?: SttScheduler;
}

export interface WebSpeechStatePayload {
  provider: 'webspeech';
  label: typeof WEBSPEECH_LABEL;
  /**
   * Always false: this code uploads no audio. The browser's own speech service (Google in
   * Chrome) still receives it, so this is not a claim that audio stays on the device.
   */
  audioUploadedByThisCode: false;
  state: SttState;
}

function classifyError(error: string): { code: SttErrorCode; retryable: boolean } | null {
  switch (error) {
    case 'no-speech':
    case 'aborted':
      return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return { code: 'auth', retryable: false };
    case 'audio-capture':
      return { code: 'bad_audio', retryable: false };
    case 'network':
      return { code: 'closed', retryable: true };
    default:
      return { code: 'unknown', retryable: false };
  }
}

/**
 * Try-it provider on the browser SpeechRecognition API. It emits text and confidence only, never
 * touches audio (write is a no-op), and tags evidence with sttProvider "webspeech".
 */
export class WebSpeechStt implements InstrumentedSttProvider {
  readonly name = 'webspeech' as const;
  readonly stats = new SttStats();
  /** Value for evidence.sttProvider on every decision made from this provider's text. */
  readonly evidence = { sttProvider: 'webspeech' } as const;

  private readonly opts: WebSpeechSttOptions;
  private readonly scheduler: SttScheduler;
  private readonly channel = new EventChannel<SttEvent>(1024);
  private rec: SpeechRecognitionLike | null = null;
  private current: SttState = 'closed';
  private t0 = 0;
  private segStartMs: number | null = null;
  private started = false;
  private stopped = false;
  private halted = false;
  private done = false;
  private onEnded: (() => void) | null = null;

  constructor(opts: WebSpeechSttOptions) {
    this.opts = opts;
    this.scheduler = opts.scheduler ?? realSttScheduler;
  }

  /** State payload for the UI, always carrying the less-accurate label. */
  statePayload(): WebSpeechStatePayload {
    return {
      provider: 'webspeech',
      label: WEBSPEECH_LABEL,
      audioUploadedByThisCode: false,
      state: this.current,
    };
  }

  start(): Promise<void> {
    if (this.started || this.stopped) return Promise.resolve();
    this.started = true;
    this.t0 = this.opts.now();
    this.setState('connecting');
    const rec = this.opts.recognition();
    if (!rec) {
      this.emit({ type: 'error', code: 'unknown', retryable: false });
      this.close();
      return Promise.resolve();
    }
    this.rec = rec;
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => this.handleResult(ev);
    rec.onerror = (ev) => {
      const c = classifyError(ev.error);
      if (!c) return;
      this.emit({ type: 'error', code: c.code, retryable: c.retryable });
      if (!c.retryable) this.halted = true;
    };
    rec.onend = () => {
      this.onEnded?.();
      if (this.stopped) return;
      if (this.halted) {
        this.close();
        return;
      }
      // Browsers end continuous recognition on their own after silence; keep listening.
      try {
        rec.start();
      } catch {
        this.emit({ type: 'error', code: 'closed', retryable: true });
        this.close();
      }
    };
    try {
      rec.start();
    } catch {
      this.emit({ type: 'error', code: 'unknown', retryable: false });
      this.close();
      return Promise.resolve();
    }
    this.setState('open');
    return Promise.resolve();
  }

  /** Audio never leaves the browser recognizer through this provider, so batches are ignored. */
  write(batch: AudioBatch): void {
    void batch;
  }

  events(): AsyncIterable<SttEvent> {
    return this.channel.iterable();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const rec = this.rec;
    if (rec && this.current === 'open') {
      // stop() makes the browser deliver its last result before it ends the session.
      await new Promise<void>((resolve) => {
        const cancel = this.scheduler.after(resolve, WAIT_FOR_END_MS);
        this.onEnded = () => {
          cancel();
          resolve();
        };
        try {
          rec.stop();
        } catch {
          this.onEnded();
        }
      });
      this.onEnded = null;
    }
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
    }
    this.close();
  }

  private handleResult(ev: RecognitionEvent): void {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const result = ev.results[i];
      const alt = result?.[0];
      if (!result || !alt) continue;
      const text = alt.transcript.trim();
      if (text === '') continue;
      const nowMs = this.opts.now() - this.t0;
      const startMs = this.segStartMs ?? nowMs;
      if (!result.isFinal) {
        this.segStartMs = startMs;
        this.emit({ type: 'interim', text, startMs });
        continue;
      }
      this.segStartMs = null;
      const c = alt.confidence;
      const confidence =
        Number.isFinite(c) && c > 0 ? Math.min(1, c) : WEBSPEECH_FALLBACK_CONFIDENCE;
      this.emit({
        type: 'final',
        text,
        words: [],
        startMs,
        endMs: Math.max(startMs, nowMs),
        confidence,
        speechFinal: true,
      });
    }
  }

  private setState(state: SttState): void {
    this.current = state;
    this.emit({ type: 'state', state });
  }

  private close(): void {
    this.stopped = true;
    if (this.done) return;
    this.done = true;
    this.setState('closed');
    this.channel.close();
  }

  private emit(event: SttEvent): void {
    this.stats.observe(event);
    this.channel.push(event);
  }
}
