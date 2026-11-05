import { appendFileSync, closeSync, fsyncSync, openSync } from 'node:fs';
import type { PaymentAudit } from '@gavel/payments';
import type { Clock } from '@gavel/shared';
import { createLogger, type LogSink } from '../log/logger';

export interface PaymentAuditSink {
  append(entry: PaymentAudit): Promise<void>;
}

/**
 * The sink for money-call and kill-switch records. It does not follow LOG_LEVEL: every entry is
 * written as an info line through its own logger, and, when a file is given, appended to it
 * and synced so the record is durable (R-PAY-093).
 */
export function createPaymentAudit(opts: {
  clock: Clock;
  sink: LogSink;
  file?: string | undefined;
}): PaymentAuditSink {
  const log = createLogger({ clock: opts.clock, sink: opts.sink, level: 'info' });
  return {
    append: (entry) => {
      if (opts.file !== undefined) {
        const fd = openSync(opts.file, 'a');
        try {
          appendFileSync(fd, `${JSON.stringify(entry)}\n`);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
      log.info('payment audit', entry);
      return Promise.resolve();
    },
  };
}
