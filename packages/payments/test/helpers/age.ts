import { newJournal } from '../../src/saga/create.js';
import type { AuditSink, Clock } from '../../src/ports.js';
import type { Journal, PaymentAudit, SettlementPlan } from '../../src/types.js';

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

/** The age policy that never flags a hold. */
export const FRESH_AGE = { nowMs: 0, holdMaxAgeMs: 7_200_000 };

/** A journal for a plan, created with the age policy that never flags a hold. */
export function freshJournal(plan: SettlementPlan): Journal {
  return newJournal(plan, FRESH_AGE);
}
