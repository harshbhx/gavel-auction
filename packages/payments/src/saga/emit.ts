import type { AuditSink, JournalStore } from '../ports.js';
import { canonicalJson } from '../types.js';
import type { HoldStatus, Journal, PaymentAudit } from '../types.js';
import { fallbackOf } from './fallback.js';

/**
 * Settlement payloads (SPEC 5.4; R-PAY-064, R-PAY-065, R-PAY-132).
 *
 * `emittingAudit` wraps the runner's AuditSink. Every entry is appended to the
 * wrapped sink first, so the audit trail never trails the wire. Then:
 *   - a `state_change` entry publishes one `settlement_update` built from the
 *     journal as saved for that transition;
 *   - every other entry (a money call, a kill switch change, a void-all) publishes
 *     one `audit_event`.
 * Payloads are published as canonical JSON (sorted keys, no whitespace), so equal
 * payloads are equal bytes and a hash chain over them is stable.
 *
 * The phases write one `paypal_call` entry per call they make, with the attempt
 * number of the call. Attempts the HTTP client retries below the gateway are
 * reported by its own per-attempt log line (R-PAY-130).
 */

export interface SettlementUpdateHold {
  bidderId: string;
  holdId: string;
  status: HoldStatus;
}

export interface SettlementUpdate {
  type: 'settlement_update';
  auctionId: string;
  state: Journal['state'];
  holds: SettlementUpdateHold[];
  fromBidderId: string | null;
  toBidderId: string | null;
  reason: string | null;
  capture: { bidderId: string; captureId: string; amountCents: number } | null;
  tsMs: number;
}

export interface AuditEventPayload {
  type: 'audit_event';
  auctionId: string | null;
  kind: PaymentAudit['kind'];
  op: string | null;
  holdId: string | null;
  requestId: string | null;
  attempt: number | null;
  status: number | null;
  outcome: 'definite' | 'unknown' | null;
  debugId: string | null;
  label: string | null;
  actor: string | null;
  tsMs: number;
}

/** What a hold looks like to the viewer, from the journal alone. */
function holdStatus(j: Journal, bidderId: string, holdId: string): HoldStatus {
  if (j.winner?.holdId === holdId) return 'CAPTURED';
  const failed = j.failed.find((f) => f.bidderId === bidderId);
  const voided = Object.hasOwn(j.voids, bidderId)
    ? j.voids[bidderId]
    : Object.hasOwn(j.voids, holdId)
      ? j.voids[holdId]
      : undefined;
  if (voided === 'voided' || voided === 'released') return 'VOIDED';
  if (failed !== undefined) {
    if (failed.reason === 'hold_voided') return 'VOIDED';
    if (failed.reason === 'hold_expired') return 'EXPIRED';
    return 'DENIED';
  }
  return 'HELD';
}

/** The `settlement_update` for a journal as saved at `tsMs`. */
export function settlementUpdateFor(j: Journal, tsMs: number): SettlementUpdate {
  const fb = fallbackOf(j);
  const holds = Object.entries(j.holds)
    .map(([bidderId, h]) => ({
      bidderId,
      holdId: h.holdId,
      status: holdStatus(j, bidderId, h.holdId),
    }))
    .sort((a, b) => (a.bidderId < b.bidderId ? -1 : a.bidderId > b.bidderId ? 1 : 0));
  return {
    type: 'settlement_update',
    auctionId: j.auctionId,
    state: j.state,
    holds,
    fromBidderId: fb?.fromBidderId ?? null,
    toBidderId: fb?.toBidderId ?? null,
    reason: fb?.reason ?? null,
    capture:
      j.winner === null
        ? null
        : {
            bidderId: j.winner.bidderId,
            captureId: j.winner.captureId,
            amountCents: j.winner.amountCents,
          },
    tsMs,
  };
}

/** The `audit_event` for one audit entry. */
export function auditEventFor(e: PaymentAudit): AuditEventPayload {
  return {
    type: 'audit_event',
    auctionId: e.auctionId ?? null,
    kind: e.kind,
    op: e.op ?? null,
    holdId: e.holdId ?? null,
    requestId: e.requestId ?? null,
    attempt: e.attempt ?? null,
    status: e.status ?? null,
    outcome: e.outcome ?? null,
    debugId: e.debugId ?? null,
    label: e.label ?? null,
    actor: e.actor ?? null,
    tsMs: e.tsMs,
  };
}

export type SettlementPayload = SettlementUpdate | AuditEventPayload;

export interface EmitDeps {
  journals: JournalStore;
  /** The sink every entry still goes to. */
  inner: AuditSink;
  /** Receives each payload with its canonical JSON. */
  publish: (payload: SettlementPayload, json: string) => Promise<void> | void;
}

/** An AuditSink that also publishes the wire payload of every entry. */
export function emittingAudit(deps: EmitDeps): AuditSink {
  return {
    async append(e: PaymentAudit): Promise<void> {
      await deps.inner.append(e);
      if (e.kind === 'state_change' && e.auctionId !== undefined) {
        const journal = await deps.journals.load(e.auctionId);
        if (journal === null) return;
        const payload = settlementUpdateFor(journal, e.tsMs);
        await deps.publish(payload, canonicalJson(payload));
        return;
      }
      const payload = auditEventFor(e);
      await deps.publish(payload, canonicalJson(payload));
    },
  };
}
