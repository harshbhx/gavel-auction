export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface PaymentLogEvent {
  level?: LogLevel;
  ts?: number;
  auctionId?: string;
  holdId?: string;
  op: string;
  requestId?: string;
  attempt?: number;
  status?: number;
  debugId?: string;
  latencyMs?: number;
  outcome?: string;
  kind?: string;
  /** Free text; redacted. */
  message?: string;
  /** Error to describe; only name, message and kind are logged, redacted. */
  error?: unknown;
}

export type LogSink = (line: string) => void;

export const REDACTED = '[REDACTED]';

const SECRET_KEY = /secret|token|authorization|signature|password|api[-_]?key/i;
const registered = new Set<string>();

/** Register an exact secret value that must never be written (e.g. the client secret). */
export function registerSecret(value: string): void {
  if (value.length >= 4) registered.add(value);
}

export function clearRegisteredSecrets(): void {
  registered.clear();
}

export function redactString(input: string): string {
  let out = input;
  for (const s of registered) out = out.split(s).join(REDACTED);
  out = out.replace(/\b(Basic|Bearer)\s+[A-Za-z0-9+/=._~-]+/gi, `$1 ${REDACTED}`);
  out = out.replace(
    /("?(?:[A-Za-z_-]*(?:secret|token|authorization|signature|password)[A-Za-z_-]*)"?\s*[:=]\s*)("?)[^\s",}&]+/gi,
    `$1$2${REDACTED}`,
  );
  return out;
}

export function redactValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v, k);
    return out;
  }
  return value;
}

function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const kind = (err as { kind?: unknown }).kind;
    return { name: err.name, message: err.message, ...(typeof kind === 'string' ? { kind } : {}) };
  }
  return { message: String(err) };
}

let sink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

/** Replace the sink (tests). Returns the previous one. */
export function setLogSink(next: LogSink): LogSink {
  const prev = sink;
  sink = next;
  return prev;
}

/** The single logging choke point for payments code (R-PAY-130). */
export function logPayment(event: PaymentLogEvent): void {
  const { error, ts, level, ...rest } = event;
  const record: Record<string, unknown> = {
    ts: ts ?? Date.now(),
    level: level ?? 'info',
    ...rest,
  };
  if (error !== undefined) record['error'] = describeError(error);
  sink(redactString(JSON.stringify(redactValue(record))));
}
