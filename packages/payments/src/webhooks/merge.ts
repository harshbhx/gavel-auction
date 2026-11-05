import { PayPalError } from '../errors.js';
import { decimalToCents } from '../money.js';
import type { AuditSink, Clock, HoldStore, PaymentsGateway, PaymentsMetrics } from '../ports.js';
import type { HoldRecord, HoldStatus, HoldTruth } from '../types.js';

/**
 * Webhooks are hints (SPEC 3.7, R-PAY-095, R-PAY-097, R-PAY-098, 6.5). A verified
 * event is mapped to a `HoldHint`; the processor then asks PayPal for the hold's
 * truth (`observeHold`) and merges the observed status into the hold record with
 * a monotonic rule. The amounts in an event body are never written anywhere.
 */

export const HINT_KINDS = [
  'authorization_created',
  'authorization_voided',
  'capture_completed',
  'capture_denied',
  'capture_pending',
  'order_approved',
] as const;
export type HintKind = (typeof HINT_KINDS)[number];

const KIND_BY_TYPE: Readonly<Record<string, HintKind>> = {
  'PAYMENT.AUTHORIZATION.CREATED': 'authorization_created',
  'PAYMENT.AUTHORIZATION.VOIDED': 'authorization_voided',
  'PAYMENT.CAPTURE.COMPLETED': 'capture_completed',
  'PAYMENT.CAPTURE.DENIED': 'capture_denied',
  'PAYMENT.CAPTURE.PENDING': 'capture_pending',
  'CHECKOUT.ORDER.APPROVED': 'order_approved',
};

export interface HoldHint {
  kind: HintKind;
  holdId?: string;
  authId?: string;
  captureId?: string;
  orderId?: string;
  /** What the event body claims was captured. Only compared against the truth, never stored. */
  claimedCents?: number;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function rec(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function claimedCents(resource: Record<string, unknown>): number | undefined {
  const direct = resource['amountCents'];
  if (typeof direct === 'number' && Number.isInteger(direct) && direct >= 0) return direct;
  const value = str(rec(resource['amount'])?.['value']);
  if (value === undefined) return undefined;
  try {
    return decimalToCents(value, { lenient: true });
  } catch {
    return undefined;
  }
}

/**
 * Event type and resource to a hint, or null for a type that is stored and
 * acknowledged only (R-PAY-098). The resource shapes for AUTHORIZE flows are
 * UNVERIFIED (gate G4); the fake's keys (`authId`, `captureId`, `orderId`) and
 * PayPal's documented ones (`id`, `supplementary_data.related_ids`) both work.
 * Fallback: reconciliation (R-PAY-100) covers every transition.
 */
export function toHint(
  eventType: string,
  resource: Record<string, unknown> | null,
): HoldHint | null {
  const kind = KIND_BY_TYPE[eventType];
  if (kind === undefined) return null;
  const r = resource ?? {};
  const related = rec(rec(r['supplementary_data'])?.['related_ids']);
  const hint: HoldHint = { kind };
  const holdId = str(r['holdId']);
  if (holdId !== undefined) hint.holdId = holdId;
  const own = str(r['id']);
  const authId =
    str(r['authId']) ??
    str(related?.['authorization_id']) ??
    (kind === 'authorization_created' || kind === 'authorization_voided' ? own : undefined);
  if (authId !== undefined) hint.authId = authId;
  const captureId =
    str(r['captureId']) ??
    (kind === 'capture_completed' || kind === 'capture_denied' || kind === 'capture_pending'
      ? own
      : undefined);
  if (captureId !== undefined) hint.captureId = captureId;
  const orderId =
    str(r['orderId']) ??
    str(related?.['order_id']) ??
    (kind === 'order_approved' ? own : undefined);
  if (orderId !== undefined) hint.orderId = orderId;
  const claimed = claimedCents(r);
  if (claimed !== undefined) hint.claimedCents = claimed;
  return hint;
}

const TERMINAL: readonly HoldStatus[] = ['VOIDED', 'EXPIRED', 'DENIED'];
const RANK: Readonly<Partial<Record<HoldStatus, number>>> = {
  PENDING_APPROVAL: 0,
  HELD: 1,
  CAPTURED: 2,
};

export type MergeDecision =
  | { apply: true; status: HoldStatus }
  | { apply: false; reason: 'same' | 'stale' | 'conflict' | 'unobserved' };

/**
 * Monotonic merge of an observed status into the current one:
 * PENDING_APPROVAL < HELD < CAPTURED; VOIDED, EXPIRED and DENIED are final.
 * CAPTURED against a final status, or one final status against another, is a
 * conflict and is not applied.
 */
export function mergeStatus(current: HoldStatus, observed: HoldStatus): MergeDecision {
  if (observed === 'UNKNOWN') return { apply: false, reason: 'unobserved' };
  if (current === observed) return { apply: false, reason: 'same' };
  if (current === 'UNKNOWN') return { apply: true, status: observed };
  const curFinal = TERMINAL.includes(current);
  const obsFinal = TERMINAL.includes(observed);
  if ((curFinal || current === 'CAPTURED') && (obsFinal || observed === 'CAPTURED')) {
    return { apply: false, reason: 'conflict' };
  }
  if (curFinal) return { apply: false, reason: 'stale' };
  if (obsFinal) return { apply: true, status: observed };
  const cur = RANK[current] ?? 0;
  const obs = RANK[observed] ?? 0;
  return obs > cur ? { apply: true, status: observed } : { apply: false, reason: 'stale' };
}

export function truthToStatus(t: HoldTruth): HoldStatus {
  switch (t.status) {
    case 'CREATED':
    case 'PENDING':
      return 'HELD';
    case 'PARTIALLY_CAPTURED':
    case 'CAPTURED':
      // R11-O03: a capture PayPal still lists as PENDING may yet be declined.
      return t.captures !== null && t.captures.length > 0 && t.captures.every((c) => c.pending)
        ? 'HELD'
        : 'CAPTURED';
    case 'VOIDED':
    case 'EXPIRED':
    case 'DENIED':
      return t.status;
    case 'NOT_FOUND':
      return 'UNKNOWN';
  }
}

/** Serialises work per key so two events for one hold never interleave their read-merge-write. */
export class KeyedQueue {
  private tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}

export interface ObserveDeps {
  gateway: Pick<PaymentsGateway, 'getHoldTruth'>;
  holds: Pick<HoldStore, 'get' | 'put'>;
  audit: AuditSink;
  clock: Clock;
  metrics?: PaymentsMetrics;
  queue?: KeyedQueue;
}

export type ObserveOutcome = 'applied' | 'unchanged' | 'stale' | 'conflict' | 'unobservable';

export interface ObserveResult {
  outcome: ObserveOutcome;
  /** The hold's status after the merge. */
  status: HoldStatus;
  /** What PayPal reports; the only source for money (R-PAY-095). */
  capturedCents: number | null;
  /** The status before this merge. */
  previous: HoldStatus;
  findings: Array<'AMOUNT_MISMATCH'>;
}

const sharedQueue = new KeyedQueue();

/** The queue every hold writer uses unless it is given its own (R8-P04). */
export const sharedHoldQueue = sharedQueue;

/**
 * Truth check for one known hold, then monotonic merge into its record.
 * A truth read that fails with a PayPal error is `unobservable` (retry later).
 */
export async function observeHold(
  deps: ObserveDeps,
  found: HoldRecord,
  hint: HoldHint,
): Promise<ObserveResult> {
  const queue = deps.queue ?? sharedQueue;
  return queue.run(found.holdId, async () => {
    // Read inside the queue so that the baseline includes earlier events for this hold.
    const record = (await deps.holds.get(found.holdId)) ?? found;
    const authId = record.authId ?? hint.authId;
    const unobservable: ObserveResult = {
      outcome: 'unobservable',
      status: record.status,
      previous: record.status,
      capturedCents: null,
      findings: [],
    };
    if (authId === undefined) return unobservable;
    let truth: HoldTruth;
    try {
      truth = await deps.gateway.getHoldTruth({
        holdId: record.holdId,
        authId,
        ...(record.orderId === '' ? {} : { orderId: record.orderId }),
      });
    } catch (e) {
      if (e instanceof PayPalError) return unobservable;
      throw e;
    }
    const observed = truthToStatus(truth);
    const findings: ObserveResult['findings'] = [];
    if (hint.claimedCents !== undefined && hint.claimedCents !== truth.capturedCents) {
      findings.push('AMOUNT_MISMATCH');
      deps.metrics?.incr('reconcile_findings_total', { code: 'AMOUNT_MISMATCH' });
      await deps.audit.append({
        kind: 'state_change',
        op: 'webhook_merge',
        label: 'AMOUNT_MISMATCH',
        holdId: record.holdId,
        from: String(hint.claimedCents),
        to: String(truth.capturedCents),
        tsMs: deps.clock.nowMs(),
      });
    }

    // The truth read was a network call: take the record as it is now, so a write made
    // meanwhile (an approval storing the authorization id) is merged, not overwritten.
    const latest = (await deps.holds.get(record.holdId)) ?? record;
    const decision = mergeStatus(latest.status, observed);
    const base = {
      previous: latest.status,
      capturedCents: truth.capturedCents,
      findings,
    };
    if (decision.apply) {
      // R8-P03: a pending hold has no authorization id yet. HELD without one cannot be
      // captured or voided and would lock the approval flow out, so the approval stores
      // the authorization id and the status together; a webhook only merges terminal states.
      if (
        decision.status === 'HELD' &&
        latest.status === 'PENDING_APPROVAL' &&
        latest.authId === undefined
      ) {
        await deps.audit.append({
          kind: 'state_change',
          op: 'webhook_merge',
          label: 'pending_left_to_approval',
          holdId: latest.holdId,
          from: latest.status,
          to: decision.status,
          tsMs: deps.clock.nowMs(),
        });
        return { ...base, outcome: 'unchanged' as const, status: latest.status };
      }
      await deps.holds.put({ ...latest, status: decision.status });
      return { ...base, outcome: 'applied' as const, status: decision.status };
    }
    if (decision.reason === 'conflict') {
      await deps.audit.append({
        kind: 'state_change',
        op: 'webhook_merge',
        label: 'status_conflict',
        holdId: latest.holdId,
        from: latest.status,
        to: observed,
        tsMs: deps.clock.nowMs(),
      });
      return { ...base, outcome: 'conflict' as const, status: latest.status };
    }
    if (decision.reason === 'unobserved') {
      return { ...base, outcome: 'unobservable' as const, status: latest.status };
    }
    return {
      ...base,
      outcome: decision.reason === 'same' ? ('unchanged' as const) : ('stale' as const),
      status: latest.status,
    };
  });
}
