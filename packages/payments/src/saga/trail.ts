import type { AuditSink } from '../ports.js';
import type { Journal, JournalHistoryEntry, PaymentAudit } from '../types.js';

/**
 * The `state_change` rows of a settlement (R-PAY-132, RT4-saga-04).
 *
 * A transition is one compare-and-set save of the journal, and its row is appended after
 * the save: the settlement update published with the row is read from the saved journal.
 * A crash between the save and the row would lose the row, so the journal history is the
 * source of the rows and `auditedSeq` says how far they are known written:
 *
 *   - a transition is saved with `auditedSeq` at the rows written before it, then its row
 *     is appended;
 *   - every later save of the run carries the new `auditedSeq`, and a run that ends right
 *     after a row saves it once more;
 *   - a run starts by appending the rows of the history entries above `auditedSeq`
 *     (`recoverTrail`), before any other effect.
 *
 * Every row carries the `seq` of its history entry and is built from that entry alone, so
 * the row written again after a crash between the row and the next save is the same row
 * with the same seq; a sink that keys on auction id and seq writes it once.
 */

/** The row of one history entry of a settlement journal. */
export function stateChangeRow(auctionId: string, h: JournalHistoryEntry): PaymentAudit {
  return {
    kind: 'state_change',
    auctionId,
    from: h.from,
    to: h.to,
    label: h.label,
    seq: h.seq,
    tsMs: h.tsMs,
  };
}

/** The history seq through which the rows are known written. */
export function auditedThrough(j: Journal): number {
  return j.auditedSeq ?? j.history.length;
}

/**
 * Appends the rows a crash may have lost: those of the history entries above `auditedSeq`,
 * in order. Returns the seq the rows are now written through, for the run's next save.
 */
export async function recoverTrail(audit: AuditSink, j: Journal): Promise<number> {
  const through = auditedThrough(j);
  for (const h of j.history) {
    if (h.seq > through) await audit.append(stateChangeRow(j.auctionId, h));
  }
  return Math.max(through, j.history.length);
}
