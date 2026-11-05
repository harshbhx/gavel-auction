import type { Clock, Logger } from '@gavel/shared';

/** Structured JSON-lines logger with redaction by key and by pattern (R-RT-132). */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const REDACTED = '[redacted]';

/** Keys whose values are never logged, matched case-insensitively. */
const SECRET_KEY =
  /token|secret|authorization|password|passwd|cookie|api[-_]?key|signature|bearer|admin|key|dsn|database[-_]?url|credential/i;

/** True when a field name must never be logged; config redaction uses the same list (R-RT-132). */
export function isSecretKey(name: string): boolean {
  return SECRET_KEY.test(name);
}

/** Values shaped like secrets are replaced wherever they appear in a string. */
const SECRET_PATTERNS: readonly RegExp[] = [
  // A password inside a connection URL: scheme://user:password@host.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:[^\s@/]+@/gi,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // Signed token: base64url payload, a dot, base64url signature.
  /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}(?:\.[A-Za-z0-9_-]{8,})?\b/g,
];

const MAX_DEPTH = 8;

export function redactString(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' || typeof value === 'symbol' ? undefined : value;
  }
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[truncated]';
  seen.add(value);
  let out: unknown;
  if (value instanceof Error) {
    out = { name: value.name, message: redactString(value.message) };
  } else if (Array.isArray(value)) {
    out = value.map((v) => redact(v, depth + 1, seen));
  } else {
    const rec: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      rec[k] = isSecretKey(k) ? REDACTED : redact(v, depth + 1, seen);
    }
    out = rec;
  }
  seen.delete(value);
  return out;
}

export type LogSink = (line: string) => void;

/** In-memory sink for tests. */
export class MemorySink {
  readonly lines: string[] = [];

  readonly write: LogSink = (line) => {
    this.lines.push(line);
  };

  records(): Array<Record<string, unknown>> {
    return this.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  }
}

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LoggerOptions {
  clock: Clock;
  sink: LogSink;
  /** Lowest level written. Default `info`. */
  level?: LogLevel;
  context?: object;
}

export function createLogger(opts: LoggerOptions): Logger {
  const min = RANK[opts.level ?? 'info'];
  const build = (base: Record<string, unknown>): Logger => {
    const emit = (level: LogLevel, msg: string, ctx?: object): void => {
      if (RANK[level] < min) return;
      const context = redact({ ...base, ...(ctx ?? {}) }) as Record<string, unknown>;
      opts.sink(JSON.stringify({ ts: opts.clock.now(), level, msg: redactString(msg), context }));
    };
    return {
      debug: (m, c) => emit('debug', m, c),
      info: (m, c) => emit('info', m, c),
      warn: (m, c) => emit('warn', m, c),
      error: (m, c) => emit('error', m, c),
      child: (c) => build({ ...base, ...(redact(c) as Record<string, unknown>) }),
    };
  };
  return build(opts.context ? (redact(opts.context) as Record<string, unknown>) : {});
}
