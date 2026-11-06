import { PayPalError } from '../errors.js';
import type { AuditSink, Clock } from '../ports.js';
import type { RequestOp } from '../requestId.js';

/**
 * One audited PayPal money call of the hold flow (R-PAY-132, RT4-saga-04): the call runs,
 * then its `paypal_call` row is written with the request id, the outcome, the HTTP status
 * and PayPal's debug id. A PayPal error is audited and thrown again; any other error is not
 * a PayPal answer and is thrown as is.
 */

export interface CallAuditDeps {
  audit: AuditSink;
  clock: Clock;
}

export interface CallRef {
  auctionId: string;
  holdId: string;
  op: RequestOp;
  requestId: string;
}

/** Status recorded for a successful call; the same values the saga's rows use. */
const OK_STATUS: Record<RequestOp, number> = {
  order: 201,
  authorize: 201,
  capture: 201,
  void: 200,
  reauth: 201,
};

export async function auditedCall<T>(
  deps: CallAuditDeps,
  ref: CallRef,
  call: () => Promise<T>,
): Promise<T> {
  let result: T;
  try {
    result = await call();
  } catch (e) {
    if (e instanceof PayPalError) {
      await deps.audit.append({
        kind: 'paypal_call',
        ...ref,
        outcome: e.outcome,
        status: e.status,
        ...(e.debugId === undefined ? {} : { debugId: e.debugId }),
        label: e.kind,
        tsMs: deps.clock.nowMs(),
      });
    }
    throw e;
  }
  await deps.audit.append({
    kind: 'paypal_call',
    ...ref,
    outcome: 'definite',
    status: OK_STATUS[ref.op],
    label: 'ok',
    tsMs: deps.clock.nowMs(),
  });
  return result;
}
