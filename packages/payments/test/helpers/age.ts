import type { AuditSink, Clock } from '../../src/ports.js';
import type { PaymentAudit } from '../../src/types.js';

/** Settlement-creation deps that never flag a hold: the clock stands still at zero. */
export const FRESH_HOLDS: { clock: Clock; holdMaxAgeMs: number; audit: AuditSink } = {
  clock: { nowMs: () => 0 },
  holdMaxAgeMs: 7_200_000,
  audit: { append: async () => undefined },
};

/** An audit sink that keeps what it was given. */
export function recordingAudit(): { sink: AuditSink; rows: PaymentAudit[] } {
  const rows: PaymentAudit[] = [];
  return {
    rows,
    sink: {
      append: (e) => {
        rows.push(e);
        return Promise.resolve();
      },
    },
  };
}
