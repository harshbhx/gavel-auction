import type {
  AuditSink,
  Clock,
  HoldStore,
  JournalStore,
  PaymentsGateway,
  PaymentsMetrics,
} from '../ports.js';
import type { HoldStatus, HoldTruth, Journal, JournalHold } from '../types.js';

/**
 * Reconciliation (SPEC 3.8, R-PAY-100, R-PAY-103): compares the settlement journal
 * and the hold records with what PayPal reports for every hold of an auction.
 * It only reads; nothing here captures, voids or edits the journal.
 */

export const FINDING_CODES = [
  'AMOUNT_MISMATCH',
  'EXTRA_CAPTURE',
  'LIVE_HOLD_AFTER_SETTLED',
  'MISSING_CAPTURE',
  'REFUNDED_CAPTURE',
  'STATUS_CONFLICT',
  'STATUS_DRIFT',
  'UNOBSERVABLE',
] as const;
export type FindingCode = (typeof FINDING_CODES)[number];

export interface Finding {
  code: FindingCode;
  bidderId: string | null;
  holdId: string | null;
  detail: string;
}

export interface ReconcileReport {
  auctionId: string;
  /** The only field that differs between two runs on unchanged state (R-PAY-103). */
  observedAt: number;
  /** Null when the auction has no journal yet. */
  journalState: Journal['state'] | null;
  /** Ordered by code, then bidderId, then holdId; at most one per code and hold. */
  findings: Finding[];
}

export interface ReconcileDeps {
  gateway: PaymentsGateway;
  journals: JournalStore;
  holds: HoldStore;
  clock: Clock;
  metrics?: PaymentsMetrics;
  /** Reserved for the repair mode; reconcile itself never writes. */
  audit?: AuditSink;
}

interface Subject {
  bidderId: string;
  holdId: string;
  authId: string | undefined;
  orderId: string | undefined;
}

const CONFLICTING: readonly HoldStatus[] = ['VOIDED', 'EXPIRED', 'DENIED'];

function truthAsHoldStatus(t: HoldTruth): HoldStatus {
  switch (t.status) {
    case 'CREATED':
    case 'PENDING':
      return 'HELD';
    case 'PARTIALLY_CAPTURED':
    case 'CAPTURED':
      return 'CAPTURED';
    case 'VOIDED':
    case 'EXPIRED':
    case 'DENIED':
      return t.status;
    case 'NOT_FOUND':
      return 'UNKNOWN';
  }
}

function conflicts(a: HoldStatus, b: HoldStatus): boolean {
  return (
    (a === 'CAPTURED' && CONFLICTING.includes(b)) || (b === 'CAPTURED' && CONFLICTING.includes(a))
  );
}

function isCaptured(t: HoldTruth): boolean {
  return t.capturedCents > 0 || t.status === 'CAPTURED' || t.status === 'PARTIALLY_CAPTURED';
}

function isLive(t: HoldTruth): boolean {
  return t.status === 'CREATED' || t.status === 'PENDING' || t.status === 'PARTIALLY_CAPTURED';
}

function order(a: Finding, b: Finding): number {
  const keys: Array<[string, string]> = [
    [a.code, b.code],
    [a.bidderId ?? '', b.bidderId ?? ''],
    [a.holdId ?? '', b.holdId ?? ''],
  ];
  for (const [x, y] of keys) if (x !== y) return x < y ? -1 : 1;
  return 0;
}

/**
 * Report every disagreement between the journal, the hold records and PayPal for one auction.
 * Truth reads that fail are reported as UNOBSERVABLE rather than thrown, so one bad hold
 * does not hide the others.
 */
export async function reconcile(deps: ReconcileDeps, auctionId: string): Promise<ReconcileReport> {
  const journal = await deps.journals.load(auctionId);
  const records = new Map((await deps.holds.listByAuction(auctionId)).map((r) => [r.holdId, r]));
  const findings = new Map<string, Finding>();
  const add = (code: FindingCode, s: Subject, detail: string): void => {
    const key = `${code}|${s.holdId}`;
    if (!findings.has(key))
      findings.set(key, { code, bidderId: s.bidderId, holdId: s.holdId, detail });
  };

  const subjects = new Map<string, Subject & { journalHold?: JournalHold }>();
  for (const r of records.values()) {
    subjects.set(r.holdId, {
      bidderId: r.bidderId,
      holdId: r.holdId,
      authId: r.authId,
      orderId: r.orderId,
    });
  }
  for (const [bidderId, jh] of Object.entries(journal?.holds ?? {})) {
    const known = subjects.get(jh.holdId);
    subjects.set(jh.holdId, {
      bidderId,
      holdId: jh.holdId,
      authId: jh.authId,
      orderId: known?.orderId,
      journalHold: jh,
    });
  }

  for (const s of subjects.values()) {
    if (s.authId === undefined) continue;
    const record = records.get(s.holdId);
    let truth: HoldTruth;
    try {
      truth = await deps.gateway.getHoldTruth({
        holdId: s.holdId,
        authId: s.authId,
        ...(s.orderId === undefined ? {} : { orderId: s.orderId }),
      });
    } catch {
      add('UNOBSERVABLE', s, 'truth read failed');
      continue;
    }
    if (truth.captures === null) add('UNOBSERVABLE', s, 'captures are not observable');
    const refunded = truth.captures?.find((c) => c.refund !== undefined);
    if (refunded?.refund !== undefined)
      add(
        'REFUNDED_CAPTURE',
        s,
        `capture ${refunded.captureId} is ${refunded.refund.status}` +
          (refunded.refund.refundedCents === undefined
            ? ''
            : `, ${refunded.refund.refundedCents} refunded`),
      );

    const winner = journal?.winner ?? null;
    const isWinner = winner !== null && winner.holdId === s.holdId;
    const captured = isCaptured(truth);
    const inFlight = journal?.intent?.op === 'capture' && journal.intent.holdId === s.holdId;
    const seen = truthAsHoldStatus(truth);
    const voidedInJournal =
      journal !== null &&
      (Object.hasOwn(journal.voids, s.bidderId) || Object.hasOwn(journal.voids, s.holdId));

    const conflict =
      (record !== undefined && conflicts(record.status, seen)) ||
      (voidedInJournal && captured) ||
      (isWinner && CONFLICTING.includes(seen));
    if (conflict) {
      add('STATUS_CONFLICT', s, `journal or record disagree with PayPal status ${truth.status}`);
    } else {
      if (isWinner && !captured)
        add('MISSING_CAPTURE', s, 'journal records a capture, PayPal has none');
      if (!isWinner && captured && !inFlight)
        add(
          'EXTRA_CAPTURE',
          s,
          `PayPal captured ${truth.capturedCents}, journal has no such capture`,
        );
      if (isWinner && captured && winner.amountCents !== truth.capturedCents)
        add('AMOUNT_MISMATCH', s, `journal ${winner.amountCents}, PayPal ${truth.capturedCents}`);
      if (
        record !== undefined &&
        record.status !== 'UNKNOWN' &&
        record.status !== seen &&
        seen !== 'UNKNOWN'
      )
        add('STATUS_DRIFT', s, `hold record ${record.status}, PayPal ${truth.status}`);
    }
    if (journal?.state === 'SETTLED' && isLive(truth))
      add('LIVE_HOLD_AFTER_SETTLED', s, `PayPal still reports ${truth.status} after SETTLED`);
  }

  const out = [...findings.values()].sort(order);
  for (const f of out) deps.metrics?.incr('reconcile_findings_total', { code: f.code });
  return {
    auctionId,
    observedAt: deps.clock.nowMs(),
    journalState: journal?.state ?? null,
    findings: out,
  };
}
