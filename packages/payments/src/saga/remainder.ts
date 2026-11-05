import { PayPalError } from '../errors.js';
import type { AuditSink, Clock, PaymentsGateway } from '../ports.js';
import { buildRequestId } from '../requestId.js';
import type { HoldTruth, Journal } from '../types.js';
import { truthArgs } from './truth.js';

/**
 * Winner remainder policy (SPEC 3.5, R-PAY-059).
 *
 * After CAPTURED the winner's authorization is read again. When PayPal reports the
 * whole hold as used or released nothing is done. What else happens follows the G1
 * decision (SPEC 7.3), `remainderMode`:
 *
 *   A        the authorization reads CAPTURED with our final capture: PayPal released the
 *            remainder. Recorded `remainder_released`, no void is sent (R12-P06).
 *   B        an open remainder is voided explicitly and recorded `remainder_voided`.
 *   C        the remainder cannot be voided; recorded `remainder_unreleased`, left to expire.
 *   unknown  as B.
 *
 * VERIFIED (G1, sandbox 2026-11-04, wallet buyer): decision A. The authorization keeps its
 * original amount (G1.6: amount 500.00, CAPTURED, captured 350.00), so the amount cannot
 * tell a released remainder from an open one, and a void afterwards always answers 422
 * PREVIOUSLY_CAPTURED (G1.7). The default is therefore A, the decision recorded in
 * `gates-result.json` (a test keeps the two equal). Card buyers are untested and card
 * checkout is off (G2); a deployment that meets an open remainder runs mode B, which the
 * fake models with `autoReleaseRemainder: false`. In mode A a hold whose order does not
 * list our final capture also takes the explicit void.
 *
 * On the explicit void a refusal that says the authorization is already captured, voided
 * or expired counts as released (not_found is not: the hold may still be live), with no
 * second effect. If the void is refused for another reason the remainder is recorded
 * `remainder_unreleased` and left to expire (G1 decision C); the settlement still completes.
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

/** The G1 decision (SPEC 7.3), as `g1_remainder_mode` in gates-result.json. */
export type RemainderMode = 'A' | 'B' | 'C' | 'unknown';

/** The recorded G1 decision (A, sandbox 2026-11-04). */
export const DEFAULT_REMAINDER_MODE: RemainderMode = 'A';

export interface RemainderDeps {
  gateway: PaymentsGateway;
  audit: AuditSink;
  clock: Clock;
  boundary?: (label: string) => Promise<void> | void;
  /** Default DEFAULT_REMAINDER_MODE. */
  remainderMode?: RemainderMode;
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
    truth = await deps.gateway.getHoldTruth(truthArgs(hold));
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
  const mode = deps.remainderMode ?? DEFAULT_REMAINDER_MODE;
  const finalCapture = (truth.captures ?? []).some(
    (c) => c.final && c.amountCents === winner.amountCents,
  );
  // Decision A (G1): CAPTURED after our final capture is the remainder released. A void
  // would only be refused (G1.7), and an unanswered one must not hold up a paid sale.
  if (mode === 'A' && finalCapture) return { status: 'auto_released' };
  // Decision C: PayPal refuses the void; the remainder lapses with the authorization.
  if (mode === 'C') return { status: 'unreleased' };

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
