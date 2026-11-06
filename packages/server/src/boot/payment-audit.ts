import { appendFileSync, closeSync, existsSync, fsyncSync, openSync, readFileSync } from 'node:fs';
import type { PaymentAudit } from '@gavel/payments';
import type { Clock } from '@gavel/shared';
import { createLogger, type LogSink } from '../log/logger';

export interface PaymentAuditSink {
  append(entry: PaymentAudit): Promise<void>;
}

/**
 * The key of a settlement's `state_change` row: the auction and the journal history seq it
 * records (RT4-saga-04). Other rows have none.
 */
function stateChangeKey(entry: Partial<PaymentAudit>): string | null {
  if (entry.kind !== 'state_change') return null;
  if (typeof entry.auctionId !== 'string' || typeof entry.seq !== 'number') return null;
  return `${entry.auctionId}#${entry.seq}`;
}

/** The keys of the settlement rows already in the file. A line that does not parse is skipped. */
function keysInFile(file: string): Set<string> {
  const keys = new Set<string>();
  if (!existsSync(file)) return keys;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"seq"')) continue;
    try {
      const key = stateChangeKey(JSON.parse(line) as Partial<PaymentAudit>);
      if (key !== null) keys.add(key);
    } catch {
      // A torn last line from a crash: the row it held is written again by the saga.
    }
  }
  return keys;
}

/**
 * The sink for money-call and kill-switch records. It does not follow LOG_LEVEL: every entry is
 * written as an info line through its own logger, and, when a file is given, appended to it
 * and synced so the record is durable (R-PAY-093).
 *
 * A settlement's `state_change` row is written once per auction and history seq. The saga
 * writes a row again after a crash between the row and its next save (RT4-saga-04); the
 * repeat is dropped here, across restarts too when a file is given.
 */
export function createPaymentAudit(opts: {
  clock: Clock;
  sink: LogSink;
  file?: string | undefined;
}): PaymentAuditSink {
  const log = createLogger({ clock: opts.clock, sink: opts.sink, level: 'info' });
  const written = opts.file === undefined ? new Set<string>() : keysInFile(opts.file);
  return {
    append: (entry) => {
      const key = stateChangeKey(entry);
      if (key !== null && written.has(key)) return Promise.resolve();
      if (opts.file !== undefined) {
        const fd = openSync(opts.file, 'a');
        try {
          appendFileSync(fd, `${JSON.stringify(entry)}\n`);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
      if (key !== null) written.add(key);
      log.info('payment audit', entry);
      return Promise.resolve();
    },
  };
}
