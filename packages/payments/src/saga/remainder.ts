import { PayPalError } from '../errors.js';
import type { AuditSink, Clock, PaymentsGateway } from '../ports.js';
import { buildRequestId } from '../requestId.js';
import type { HoldTruth, Journal } from '../types.js';

/**
 * Winner remainder policy (SPEC 3.5, R-PAY-059).
 *
 * After CAPTURED the winner's authorization is read again. When PayPal reports the
 * whole hold as used or released nothing is done. When an open remainder is
 * possible it is voided explicitly and recorded `remainder_voided`.
 *
 * UNVERIFIED (G1): whether PayPal releases the remainder by itself after a final
 * capture. Fallback: the explicit void is always attempted when the hold is larger
 * than the capture; a refusal that says the authorization is already captured,
 * voided or expired counts as released (not_found is not: the hold may still be live) (no second effect). Both fake modes
 * (`autoReleaseRemainder` true and false) are tested. If the void is refused for
 * another reason the remainder is recorded `remainder_unreleased` and left to
 * expire (G1 decision C); the settlement still completes.
 */

export type RemainderResult =
  | { status: 'auto_released' }
  | { status: 'remainder_voided' }
  | { status: 'unreleased' }
  | { status: 'unavailable' }
  | { status: 'mismatch' };

/** The journal `voids` key of a winner's remainder; never a bidder id, so reconcile ignores it. */
export function remainderKey(bidderId: string): string {
  return `remainder:${bidderId}`;
}

export interface RemainderDeps {
  gateway: PaymentsGateway;
  audit: AuditSink;
  clock: Clock;
  boundary?: (label: string) => Promise<void> | void;
}

const RELEASED_KINDS: ReadonlySet<string> = new Set([
  'already_captured',
  'already_voided',
  'expired',
]);

/** Checks the winner's authorization and voids an open remainder. Does not touch the journal. */
export async function releaseWinnerRemainder(
  deps: RemainderDeps,
  journal: Journal,
): Promise<RemainderResult> {
  const winner = journal.winner;
  if (winner === null) return { status: 'auto_released' };
  const hold = journal.holds[winner.bidderId];
  if (hold === undefined) return { status: 'mismatch' };

  let truth: HoldTruth;
  try {
    await deps.boundary?.('before:get');
    truth = await deps.gateway.getHoldTruth({ holdId: hold.holdId, authId: hold.authId });
    await deps.boundary?.('after:get');
  } catch (e) {
    if (e instanceof PayPalError) return { status: 'unavailable' };
    throw e;
  }
  if (truth.status !== 'CAPTURED' || truth.capturedCents !== winner.amountCents) {
    return { status: 'mismatch' };
  }
  const remainder = hold.ceilingCents - winner.amountCents;
  if (truth.amountCents <= truth.capturedCents || remainder <= 0) {
    return { status: 'auto_released' };
  }

  const requestId = buildRequestId({
    auctionId: journal.auctionId,
    op: 'void',
    holdId: hold.holdId,
    amountCents: remainder,
    generation: 0,
  });
  let error: PayPalError | undefined;
  try {
    await deps.boundary?.('before:void');
    await deps.gateway.voidAuthorization(hold.authId, requestId);
    await deps.boundary?.('after:void');
  } catch (e) {
    if (!(e instanceof PayPalError)) throw e;
    error = e;
  }
  await deps.audit.append({
    kind: 'paypal_call',
    auctionId: journal.auctionId,
    holdId: hold.holdId,
    op: 'void',
    requestId,
    attempt: 1,
    outcome: error === undefined ? 'definite' : error.outcome,
    status: error === undefined ? 200 : error.status,
    ...(error?.debugId === undefined ? {} : { debugId: error.debugId }),
    label: error === undefined ? 'remainder_voided' : error.kind,
    tsMs: deps.clock.nowMs(),
  });
  if (error === undefined) return { status: 'remainder_voided' };
  if (RELEASED_KINDS.has(error.kind)) return { status: 'auto_released' };
  if (error.outcome === 'unknown') return { status: 'unavailable' };
  return { status: 'unreleased' };
}
