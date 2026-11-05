import { PayPalError } from '../errors.js';
import type { AuditSink, Clock, PaymentsGateway } from '../ports.js';
import { buildRequestId } from '../requestId.js';

/**
 * Reauthorization policy and call path (SPEC 3.6, R-PAY-070 to R-PAY-072).
 *
 * EXPLICIT CALL ONLY. Nothing in the capture, void, create or hold phases calls this
 * module: the settlement saga never reauthorizes by itself, whatever `enabled` says
 * (R8-P08). `enabled` only gates `reauthorizeIfDue`, which an operator or a script calls
 * for a hold on request. A hold older than the honor period is flagged `stale`
 * (R-PAY-034) and captured as it is; a multi-day auction therefore needs the explicit
 * call before the capture, or PayPal may decline the capture and the saga falls back to
 * the next candidate.
 *
 * Off by default: the demo creates holds minutes before the capture, so the stale flag
 * (R-PAY-034) is the only control and nothing here runs. When `enabled` is set, a call
 * for a hold whose age is above `honorSafeMs` reauthorizes it once per generation, never
 * above its original ceiling. The result only says what happened; it never blocks a capture. A
 * stale, reauthorized or refused hold goes through the same capture path as a fresh one,
 * and a refusal is left to the normal definite-failure handling (R-PAY-072, R-PAY-053).
 *
 * UNVERIFIED (G3): the honor period, the day 4 to 29 reauthorize window and the 115% /
 * $75 limit. Fallback: keep `enabled` false; the explicit call is only made on request.
 */

const DAY_MS = 86_400_000;

/** Three days minus six hours: reauthorize before PayPal's honor period can run out. */
export const DEFAULT_HONOR_SAFE_MS = 3 * DAY_MS - 6 * 3_600_000;

export interface ReauthPolicy {
  enabled: boolean;
  honorSafeMs: number;
}

export const DEFAULT_REAUTH_POLICY: ReauthPolicy = {
  enabled: false,
  honorSafeMs: DEFAULT_HONOR_SAFE_MS,
};

/** The part of a journal hold the policy reads. */
export interface ReauthHold {
  holdId: string;
  authId: string;
  /** What the buyer approved; a reauthorization never asks for more. */
  ceilingCents: number;
  /** When the hold was created, or when it was last reauthorized. */
  startedAtMs: number;
  /** Number of reauthorizations already made; the next request id uses this. */
  generation: number;
}

export type ReauthResult =
  | { status: 'disabled' }
  | { status: 'not_due' }
  | { status: 'reauthorized'; ceilingCents: number; startedAtMs: number; generation: number }
  | { status: 'refused'; kind: string }
  | { status: 'unknown'; kind: string };

export interface ReauthDeps {
  gateway: Pick<PaymentsGateway, 'reauthorize'>;
  audit: AuditSink;
  clock: Clock;
  boundary?: (label: string) => Promise<void> | void;
}

/** True when the policy would reauthorize a hold of this age. */
export function reauthDue(policy: ReauthPolicy, hold: ReauthHold, nowMs: number): boolean {
  return policy.enabled && nowMs - hold.startedAtMs > policy.honorSafeMs;
}

/**
 * Reauthorizes one hold when the policy asks for it. Returns the new `startedAtMs` and
 * `generation` for the caller to persist with the hold. Only a PayPal failure is turned
 * into a result; any other error is a bug and propagates.
 */
export async function reauthorizeIfDue(
  deps: ReauthDeps,
  auctionId: string,
  hold: ReauthHold,
  policy: ReauthPolicy = DEFAULT_REAUTH_POLICY,
): Promise<ReauthResult> {
  if (!policy.enabled) return { status: 'disabled' };
  const nowMs = deps.clock.nowMs();
  if (!reauthDue(policy, hold, nowMs)) return { status: 'not_due' };

  const generation = hold.generation + 1;
  const requestId = buildRequestId({
    auctionId,
    op: 'reauth',
    holdId: hold.holdId,
    amountCents: hold.ceilingCents,
    generation,
  });
  let error: PayPalError | undefined;
  try {
    await deps.boundary?.('before:reauth');
    await deps.gateway.reauthorize(hold.authId, {
      amountCents: hold.ceilingCents,
      requestId,
    });
    await deps.boundary?.('after:reauth');
  } catch (e) {
    if (!(e instanceof PayPalError)) throw e;
    error = e;
  }
  await deps.audit.append({
    kind: 'paypal_call',
    auctionId,
    holdId: hold.holdId,
    op: 'reauth',
    requestId,
    attempt: 1,
    outcome: error === undefined ? 'definite' : error.outcome,
    status: error === undefined ? 200 : error.status,
    ...(error?.debugId === undefined ? {} : { debugId: error.debugId }),
    label: error === undefined ? 'reauthorized' : error.kind,
    tsMs: deps.clock.nowMs(),
  });
  if (error === undefined) {
    return {
      status: 'reauthorized',
      ceilingCents: hold.ceilingCents,
      startedAtMs: deps.clock.nowMs(),
      generation,
    };
  }
  return error.outcome === 'unknown'
    ? { status: 'unknown', kind: error.kind }
    : { status: 'refused', kind: error.kind };
}
