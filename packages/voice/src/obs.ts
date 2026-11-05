/**
 * Logging and metrics for the voice package (R-VOX-098, R-VOX-105). The logger redacts key-like
 * strings everywhere, never carries audio, and emits transcripts only at debug level. Metrics are
 * an injected interface; exporters are out of scope here.
 */

/** Metric names of spec section 13. */
export const METRIC = {
  audioDroppedBatches: 'voice_audio_dropped_batches_total',
  audioDroppedMs: 'voice_audio_dropped_ms_total',
  captureState: 'voice_capture_state',
  sttFinal: 'voice_stt_final_total',
  sttError: 'voice_stt_error_total',
  sttFailover: 'voice_stt_failover_total',
  sttLatencyMs: 'voice_stt_latency_ms',
  llmTimeout: 'voice_llm_timeout_total',
  llmInvalid: 'voice_llm_invalid_total',
  decision: 'voice_decision_total',
  confirm: 'voice_confirm_total',
  decisionLatencyMs: 'voice_decision_latency_ms',
  promptSuppressed: 'voice_prompt_suppressed_total',
} as const;

export type MetricName = (typeof METRIC)[keyof typeof METRIC];
export type Labels = Readonly<Record<string, string>>;

export interface Metrics {
  counter(name: MetricName, labels?: Labels, by?: number): void;
  histogram(name: MetricName, value: number, labels?: Labels): void;
}

export const noopMetrics: Metrics = {
  counter: () => undefined,
  histogram: () => undefined,
};

export interface MetricsSpy extends Metrics {
  /** Counter total for a name and exact label set. */
  total(name: MetricName, labels?: Labels): number;
  /** Observed histogram values for a name and exact label set. */
  observations(name: MetricName, labels?: Labels): readonly number[];
}

function seriesKey(name: string, labels: Labels | undefined): string {
  const pairs = Object.entries(labels ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${name}|${pairs.map(([k, v]) => `${k}=${v}`).join(',')}`;
}

/** In-memory metrics for tests and for the eval harness. */
export function createMetricsSpy(): MetricsSpy {
  const counters = new Map<string, number>();
  const histograms = new Map<string, number[]>();
  return {
    counter(name, labels, by = 1) {
      const key = seriesKey(name, labels);
      counters.set(key, (counters.get(key) ?? 0) + by);
    },
    histogram(name, value, labels) {
      const key = seriesKey(name, labels);
      const list = histograms.get(key) ?? [];
      list.push(value);
      histograms.set(key, list);
    },
    total: (name, labels) => counters.get(seriesKey(name, labels)) ?? 0,
    observations: (name, labels) => histograms.get(seriesKey(name, labels)) ?? [],
  };
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const REDACTED = '[redacted]';

/** Patterns of secrets that must never reach a log line. */
const KEY_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bgsk_[A-Za-z0-9]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bToken\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /\b(?:api[_-]?key|secret|token|authorization)\s*[=:]\s*\S+/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
  /\b[A-Fa-f0-9]{32,}\b/g,
  /\b[A-Za-z0-9+/]{40,}={0,2}/g,
];

export function redact(text: string): string {
  return KEY_PATTERNS.reduce((acc, re) => acc.replace(re, REDACTED), text);
}

/** Field names whose value is spoken content: kept only at debug level. */
const TRANSCRIPT_KEYS = new Set(['transcript', 'text', 'caption']);
/** Field names that would carry audio: never logged. */
const AUDIO_KEYS = new Set(['audio', 'pcm', 'frame', 'frames', 'samples', 'buffer']);

export type LogFields = Readonly<Record<string, unknown>>;

function isBinary(v: unknown): boolean {
  return v instanceof ArrayBuffer || ArrayBuffer.isView(v);
}

function clean(value: unknown, depth: number, allowTranscript: boolean): unknown {
  if (typeof value === 'string') return redact(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (isBinary(value)) return REDACTED;
  if (depth >= 4) return REDACTED;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => clean(v, depth + 1, allowTranscript));
  }
  if (typeof value === 'object') return cleanFields(value as LogFields, depth + 1, allowTranscript);
  return undefined;
}

function cleanFields(fields: LogFields, depth: number, allowTranscript: boolean): LogFields {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    const name = k.toLowerCase();
    if (AUDIO_KEYS.has(name) || isBinary(v)) {
      out[k] = REDACTED;
    } else if (TRANSCRIPT_KEYS.has(name) && !allowTranscript) {
      continue;
    } else {
      out[k] = clean(v, depth, allowTranscript);
    }
  }
  return out;
}

export interface LogRecord {
  level: LogLevel;
  event: string;
  atMs: number;
  fields: LogFields;
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  level: LogLevel;
  sink: (record: LogRecord) => void;
  /** Injected clock in milliseconds. */
  now: () => number;
}

export function createLogger(options: LoggerOptions): Logger {
  const min = RANK[options.level];
  const emit =
    (level: LogLevel) =>
    (event: string, fields: LogFields = {}): void => {
      if (RANK[level] < min) return;
      options.sink({
        level,
        event: redact(event),
        atMs: options.now(),
        fields: cleanFields(fields, 0, options.level === 'debug'),
      });
    };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}
