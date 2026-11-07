import { GROQ_BID_PROMPT } from '../stt/groq.js';

/**
 * Live batch transcription of evaluation clips (R-VOX-080). One WAV goes to the provider's
 * prerecorded endpoint and comes back as text plus segments. The key is used only in a request
 * header; it never appears in an error message or a log line.
 */

/** Provider names the live adapters can call. */
export type LiveProvider = 'deepgram' | 'groq';

/** One transcribed span of a clip. */
export interface LiveSegment {
  /** 0..1; 0.5 when the provider sends none. */
  confidence: number;
  /** End offset in the clip, milliseconds. */
  endMs: number;
  /** Start offset in the clip, milliseconds. */
  startMs: number;
  /** Recognised words of the span. */
  text: string;
}

/** Transcript of one clip. */
export interface LiveTranscript {
  /** Segments in clip order; empty when nothing was recognised. */
  segments: LiveSegment[];
  /** Full recognised text. */
  text: string;
}

/** Request a live adapter hands to its fetch. */
export interface LiveRequestInit {
  /** WAV bytes (Deepgram) or a multipart form (Groq). */
  body: Uint8Array | FormData;
  /** Carries the key; never logged. */
  headers: Record<string, string>;
  method: string;
  /** Aborts the request when the per-request or total deadline passes. */
  signal?: AbortSignal;
}

/** The subset of fetch the live adapters use; tests pass a mock. */
export type LiveFetch = (
  url: string,
  init: LiveRequestInit,
) => Promise<{ status: number; json(): Promise<unknown> }>;

/** Injected dependencies of the live adapters. */
export interface LiveDeps {
  /** Base delay before a retry; doubles with each attempt. */
  backoffMs?: number;
  /** HTTP client. */
  fetch: LiveFetch;
  /** Timeout of one request in milliseconds; defaults to LIVE_REQUEST_TIMEOUT_MS. */
  requestTimeoutMs?: number;
  /** Total attempts per clip, first try included. */
  maxAttempts?: number;
  /** Deadline across all attempts in milliseconds; defaults to LIVE_TOTAL_TIMEOUT_MS. */
  totalTimeoutMs?: number;
  /** Request options of the option trials; unset means the defaults below. */
  options?: LiveOptions;
  /** Waits between attempts; defaults to a timer. */
  sleep?: (ms: number) => Promise<void>;
}

/** Provider request options a trial can change without a code edit. All unset means the defaults. */
export interface LiveOptions {
  /** Deepgram query string without the question mark, replacing the default parameters. */
  deepgramQuery?: string;
  /** Groq model name. */
  groqModel?: string;
  /** Groq prompt (vocabulary hint); null sends none. Defaults to GROQ_BID_PROMPT. */
  groqPrompt?: string | null;
  /** Groq temperature, as the string the API takes. */
  groqTemperature?: string;
}

/** The Deepgram settings the room runs (see DEEPGRAM_DEFAULT_CONFIG): nova-3, words not digits. */
export const LIVE_DEEPGRAM_URL =
  'https://api.deepgram.com/v1/listen?model=nova-3&language=en&punctuate=true&smart_format=false';
export const LIVE_GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const LIVE_GROQ_MODEL = 'whisper-large-v3-turbo';
export const LIVE_MAX_ATTEMPTS = 3;
export const LIVE_BACKOFF_MS = 400;
export const LIVE_REQUEST_TIMEOUT_MS = 60_000;
export const LIVE_TOTAL_TIMEOUT_MS = 180_000;
const FALLBACK_CONFIDENCE = 0.5;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : d;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const ms = (seconds: unknown): number => Math.round(num(seconds, 0) * 1000);

function mapDeepgram(body: unknown): LiveTranscript {
  const channels = isRecord(body) && isRecord(body['results']) ? body['results']['channels'] : null;
  const first = Array.isArray(channels) ? channels[0] : null;
  const alts = isRecord(first) ? first['alternatives'] : null;
  const alt = Array.isArray(alts) ? alts[0] : null;
  if (!isRecord(alt)) return { text: '', segments: [] };
  const text = typeof alt['transcript'] === 'string' ? alt['transcript'].trim() : '';
  const words = Array.isArray(alt['words']) ? alt['words'].filter(isRecord) : [];
  if (text === '') return { text, segments: [] };
  if (words.length === 0) {
    return {
      text,
      segments: [
        {
          text,
          startMs: 0,
          endMs: 0,
          confidence: clamp01(num(alt['confidence'], FALLBACK_CONFIDENCE)),
        },
      ],
    };
  }
  const last = words[words.length - 1] as Record<string, unknown>;
  return {
    text,
    segments: [
      {
        text,
        startMs: ms(words[0]?.['start']),
        endMs: ms(last['end']),
        confidence: clamp01(num(alt['confidence'], FALLBACK_CONFIDENCE)),
      },
    ],
  };
}

function mapGroq(body: unknown): LiveTranscript {
  if (!isRecord(body)) return { text: '', segments: [] };
  const text = typeof body['text'] === 'string' ? body['text'].trim() : '';
  const raw = Array.isArray(body['segments']) ? body['segments'].filter(isRecord) : [];
  const segments: LiveSegment[] = raw.map((s) => ({
    text: typeof s['text'] === 'string' ? s['text'].trim() : '',
    startMs: ms(s['start']),
    endMs: ms(s['end']),
    confidence:
      typeof s['avg_logprob'] === 'number'
        ? Math.round(clamp01(Math.exp(s['avg_logprob'])) * 100) / 100
        : FALLBACK_CONFIDENCE,
  }));
  if (segments.length === 0 && text !== '') {
    segments.push({ text, startMs: 0, endMs: 0, confidence: FALLBACK_CONFIDENCE });
  }
  return { text, segments };
}

function buildRequest(
  provider: LiveProvider,
  audio: Uint8Array,
  key: string,
  options: LiveOptions = {},
): { url: string; init: LiveRequestInit } {
  if (provider === 'deepgram') {
    return {
      url:
        options.deepgramQuery === undefined
          ? LIVE_DEEPGRAM_URL
          : `https://api.deepgram.com/v1/listen?${options.deepgramQuery}`,
      init: {
        method: 'POST',
        headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
        body: audio,
      },
    };
  }
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', options.groqModel ?? LIVE_GROQ_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('language', 'en');
  const prompt = options.groqPrompt === undefined ? GROQ_BID_PROMPT : options.groqPrompt;
  if (prompt !== null) form.append('prompt', prompt);
  if (options.groqTemperature !== undefined) form.append('temperature', options.groqTemperature);
  return {
    url: LIVE_GROQ_URL,
    init: { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form },
  };
}

const retryable = (status: number): boolean => status === 429 || status >= 500;

/** Rejects as soon as the signal aborts, even if the wrapped promise never settles. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error('aborted'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Transcribes one WAV clip; retries 429, 5xx and timeouts within a total deadline. */
export async function transcribeLive(
  provider: LiveProvider,
  audio: Uint8Array,
  key: string,
  deps: LiveDeps,
): Promise<LiveTranscript> {
  const attempts = Math.max(1, deps.maxAttempts ?? LIVE_MAX_ATTEMPTS);
  const backoff = deps.backoffMs ?? LIVE_BACKOFF_MS;
  const requestTimeout = deps.requestTimeoutMs ?? LIVE_REQUEST_TIMEOUT_MS;
  const deadline = Date.now() + (deps.totalTimeoutMs ?? LIVE_TOTAL_TIMEOUT_MS);
  const sleep = deps.sleep ?? ((d: number) => new Promise<void>((r) => setTimeout(r, d)));
  const timedOut = (): Error => new Error(`${provider} speech-to-text timed out`);
  let lastStatus = 0;
  let lastTimedOut = false;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timedOut();
    // A new request per attempt: a form body is consumed by the first send.
    const { url, init } = buildRequest(provider, audio, key, deps.options);
    const signal = AbortSignal.timeout(Math.min(requestTimeout, remaining));
    let status: number;
    let body: unknown = null;
    try {
      const res = await untilAborted(deps.fetch(url, { ...init, signal }), signal);
      status = res.status;
      if (status === 200) body = await untilAborted(res.json(), signal);
    } catch {
      status = 0;
    }
    lastTimedOut = status === 0 && signal.aborted;
    if (status === 200) return provider === 'deepgram' ? mapDeepgram(body) : mapGroq(body);
    lastStatus = status;
    if (status !== 0 && !retryable(status)) break;
    if (attempt < attempts) await sleep(backoff * 2 ** (attempt - 1));
  }
  if (lastTimedOut) throw timedOut();
  throw new Error(
    lastStatus === 0
      ? `${provider} speech-to-text request failed`
      : `${provider} speech-to-text answered ${lastStatus}`,
  );
}

/** Adapter in the shape the evaluation CLI expects: one call per clip id. */
export function createLiveTranscriber(
  readAudio: (id: string) => Uint8Array | undefined,
  deps: LiveDeps,
): (id: string, provider: LiveProvider, key: string) => Promise<LiveTranscript> {
  return async (id, provider, key) => {
    const audio = readAudio(id);
    if (audio === undefined) throw new Error(`recording ${id} is missing`);
    return transcribeLive(provider, audio, key, deps);
  };
}
