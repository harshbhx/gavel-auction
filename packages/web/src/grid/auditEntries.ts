import type { AuditPayload } from '../wire';
import type { LedgerEntry } from './ledgerModel';

/**
 * Audit rows as ledger entries. This lives apart from ledgerModel on purpose: the audit page uses it on
 * first load, and ledgerModel (hashing, chain checks) is only needed by the lazy grid chunks.
 * Audit rows are not sealed (the server keeps the chain; the page has no
 * hashes for them), so hash and prev stay null and the grid hides those columns.
 */
export function entriesFromAudit(
  rows: readonly AuditPayload[],
  paddleOf: (bidderId: string) => number | null,
): LedgerEntry[] {
  return rows.map((row) => {
    const paddle = paddleOf(row.bidderId);
    return {
      seq: row.seq,
      at: Number(row.serverTs),
      type: `audit_${row.outcome}`,
      actor: paddle === null ? null : `paddle:${paddle}`,
      amountCents: row.parsedAmount === undefined ? null : Number(row.parsedAmount),
      note: row.reason ?? null,
      hash: null,
      prev: null,
    };
  });
}
