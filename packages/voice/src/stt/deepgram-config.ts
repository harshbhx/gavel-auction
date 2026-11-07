/**
 * Every Deepgram vendor parameter lives in this one object so the gate G5 run can change a name, a
 * value or a message without a code edit (R-VOX-014, R-VOX-016). All of it is UNVERIFIED until G5.
 *
 * The API key is never part of the config and is never logged. Server runs read it from the
 * DEEPGRAM_API_KEY environment variable and hand it to DeepgramStt as `apiKey`.
 */
export type DeepgramParamValue = string | number | boolean;

export interface DeepgramConfig {
  /** Streaming endpoint without a query string. */
  url: string;
  /** Query parameters in the order they are written to the URL. */
  params: Record<string, DeepgramParamValue>;
  /** Idle interval between KeepAlive text messages. */
  keepAliveMs: number;
  keepAliveMessage: string;
  closeStreamMessage: string;
  /** Sent when a batch carries the end-of-stream flag, to flush the current utterance. */
  finalizeMessage: string;
  /** Socket send buffer above which a batch is dropped instead of queued (back-pressure). */
  maxBufferedBytes: number;
  /** Give up waiting for the socket to open after this long. */
  openTimeoutMs: number;
  /** After CloseStream, wait this long for the server to close before closing the socket. */
  closeWaitMs: number;
}

export const DEEPGRAM_DEFAULT_CONFIG: DeepgramConfig = {
  url: 'wss://api.deepgram.com/v1/listen',
  params: {
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: 16000,
    channels: 1,
    interim_results: true,
    punctuate: true,
    // Off: smart_format writes amounts as digits and symbols ("$350", "2.50") and scored lower in
    // the G5 option trials than the spoken words (docs/GATES.md).
    smart_format: false,
    endpointing: 300,
    utterance_end_ms: 1000,
    language: 'en',
  },
  keepAliveMs: 5000,
  keepAliveMessage: '{"type":"KeepAlive"}',
  closeStreamMessage: '{"type":"CloseStream"}',
  finalizeMessage: '{"type":"Finalize"}',
  maxBufferedBytes: 256 * 1024,
  openTimeoutMs: 5000,
  closeWaitMs: 2000,
};

/** Overrides replace whole fields; `params` entries are merged key by key. */
export function mergeDeepgramConfig(
  overrides: Partial<Omit<DeepgramConfig, 'params'>> & {
    params?: Record<string, DeepgramParamValue>;
  } = {},
): DeepgramConfig {
  return {
    ...DEEPGRAM_DEFAULT_CONFIG,
    ...overrides,
    params: { ...DEEPGRAM_DEFAULT_CONFIG.params, ...(overrides.params ?? {}) },
  };
}

/** Handshake URL: the endpoint plus the configured parameters, then any repeated extras. */
export function buildDeepgramUrl(
  config: DeepgramConfig,
  extra: ReadonlyArray<readonly [string, string]> = [],
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(config.params)) q.append(k, String(v));
  for (const [k, v] of extra) q.append(k, v);
  const s = q.toString();
  return s === '' ? config.url : `${config.url}?${s}`;
}

/** Timer seam so keepalive and backoff run on a fake clock in tests. Both return a cancel function. */
export interface SttScheduler {
  every(fn: () => void, ms: number): () => void;
  after(fn: () => void, ms: number): () => void;
}

export const realSttScheduler: SttScheduler = {
  every(fn, ms) {
    const h = setInterval(fn, ms);
    return () => clearInterval(h);
  },
  after(fn, ms) {
    const h = setTimeout(fn, ms);
    return () => clearTimeout(h);
  },
};
