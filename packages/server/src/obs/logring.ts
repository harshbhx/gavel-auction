import type { LogSink } from '../log/logger';

/** R-QA-047: the ops view shows this many recent log lines. */
export const OPS_LOG_LINES = 100;

const EMAIL =
  /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-])[A-Za-z0-9-]*((?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;

/** `alice@example.com` becomes `a***@e***.com` (R-QA-047). */
export function maskEmails(text: string): string {
  return text.replace(EMAIL, (_m, a: string, d: string, tld: string) => {
    const last = tld.slice(tld.lastIndexOf('.'));
    return `${a}***@${d}***${last}`;
  });
}

/** Wraps a sink so no full email address leaves the process in a log line. */
export function maskingSink(inner: LogSink): LogSink {
  return (line) => inner(maskEmails(line));
}

export interface LogRing {
  /** A log sink that also keeps the newest lines. */
  readonly write: LogSink;
  /** Newest last. */
  lines(): string[];
}

/** Keeps the last `limit` lines in memory for the ops view; every line is email-masked. */
export function createLogRing(inner?: LogSink, limit: number = OPS_LOG_LINES): LogRing {
  const buf: string[] = [];
  return {
    write: (line) => {
      const masked = maskEmails(line);
      buf.push(masked);
      if (buf.length > limit) buf.shift();
      inner?.(masked);
    },
    lines: () => [...buf],
  };
}
