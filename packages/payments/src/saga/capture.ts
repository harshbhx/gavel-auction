import { PayPalError } from '../errors.js';
import type { AuditSink, Clock, JournalStore, KillSwitch, PaymentsGateway } from '../ports.js';
import type { PaymentsMetrics } from '../ports.js';
import { buildRequestId } from '../requestId.js';
import type { CaptureRef, HoldTruth, Journal } from '../types.js';
import { withLease } from './create.js';
import { truthArgs } from './truth.js';
import { defaultLeaseOwner, runLeaseOwner } from './owner.js';
import { step, type SettlementEvent } from './machine.js';
import { DEFAULT_UNKNOWN_DEADLINE_MS, UNKNOWN_REVIEW_REASON, unknownExpired } from './unknown.js';

export { DEFAULT_UNKNOWN_DEADLINE_MS };

/**
 * Capture phase of the settlement runner (SPEC 3.5, 4.6; R-PAY-050 to R-PAY-056,
 * R-PAY-063). It drives a settlement from the hammer to CAPTURED:
 *
 *   for the candidate at the cursor
 *     invariants (price within the hold's ceiling, not below reserve), no PayPal call
 *     truth check on the hold: adopt a capture that is already there
 *     kill switch check, then write-ahead intent {capture, requestId, amount}
 *     capture(final, invoice id), same request id on every retry and resume
 *       ok                -> CAPTURED
 *       definite failure  -> truth check -> captured ? adopt : FALLBACK_RUNNER_UP
 *       unknown           -> unknownSince saved, `pending`; never the next candidate
 *
 * Every state change is one compare-and-set save of the journal before the next
 * effect. The runner holds the auction's lease and renews it before each step.
 * Voiding the other holds is the next phase and is not done here.
 *
 * UNVERIFIED (G1): that the order lists captures with their invoice id. When the
 * truth cannot list captures but reports the hold as captured, the capture cannot
 * be identified and the settlement goes to FAILED_NEEDS_REVIEW instead of guessing.
 */

export type PendingReason =
  | 'capture_outcome_unknown'
  | 'kill_switch'
  | 'truth_unavailable'
  | 'auth_unavailable'
  | 'capture_rejected_unclassified';

export type CaptureOutcome =
  | { status: 'captured'; journal: Journal }
  | { status: 'no_sale'; journal: Journal }
  | { status: 'pending'; reason: PendingReason; journal: Journal }
  | { status: 'failed'; reason: string; journal: Journal }
  | { status: 'busy' };

export interface CaptureDeps {
  journals: JournalStore;
  gateway: PaymentsGateway;
  audit: AuditSink;
  clock: Clock;
  killSwitch?: KillSwitch;
  metrics?: PaymentsMetrics;
  /** Default 600000 (R-PAY-055). */
  unknownDeadlineMs?: number;
  /** Lease owner. Default: the process id plus a fresh random suffix per run. */
  owner?: string;
  /**
   * Called at every crash boundary: `journaled:<event>` after a save, and
   * `before:`/`after:` the `get` and `capture` calls (SPEC 6.2). A throw here
   * simulates a crash at that point.
   */
  boundary?: (label: string) => Promise<void> | void;
}

/** Errors that cannot be answered by trying another candidate: a bug or a configuration fault. */
const INVARIANT_KINDS: ReadonlySet<string> = new Set([
  'invalid_request',
  'idempotency_conflict',
  'ceiling_out_of_range',
]);

/**
 * Definite refusals that name this hold or its instrument: only these may send the
 * settlement to the next candidate. Any other refusal (403, an unknown 4xx, an unknown
 * 422 issue) may be a merchant-wide or request-level fault that would repeat for every
 * bidder, so it stops the settlement instead of releasing the winning bids.
 */
const PER_HOLD_KINDS: ReadonlySet<string> = new Set([
  'declined',
  'expired',
  'already_voided',
  'already_captured',
  'not_found',
]);

const FAILED_TRUTH: ReadonlySet<HoldTruth['status']> = new Set([
  'VOIDED',
  'EXPIRED',
  'DENIED',
  'NOT_FOUND',
]);

export function invoiceIdFor(auctionId: string, holdId: string): string {
  return `gavel-${auctionId}-${holdId}`;
}

function terminal(journal: Journal): CaptureOutcome | null {
  switch (journal.state) {
    case 'CAPTURED':
    case 'VOIDING':
    case 'SETTLED':
      return journal.winner === null
        ? { status: 'no_sale', journal }
        : { status: 'captured', journal };
    case 'FAILED_NEEDS_REVIEW':
      return { status: 'failed', reason: lastReason(journal), journal };
    default:
      return null;
  }
}

function lastReason(j: Journal): string {
  return j.history[j.history.length - 1]?.label.replace(/^journaled:/, '') ?? 'failed';
}

/** What the truth says about the candidate's capture. */
type Verdict =
  | { kind: 'adopt'; capture: CaptureRef }
  | { kind: 'mismatch'; why: string }
  | { kind: 'gone'; why: string }
  | { kind: 'open' };

export class CapturePhase {
  private readonly owner: string;
  private readonly explicitOwner: boolean;

  constructor(private readonly deps: CaptureDeps) {
    this.owner = deps.owner ?? defaultLeaseOwner('runner');
    this.explicitOwner = deps.owner !== undefined;
  }

  /** Runs, or resumes, the capture phase of one settlement. */
  async run(auctionId: string): Promise<CaptureOutcome> {
    const leased = await withLease(
      { journals: this.deps.journals, clock: this.deps.clock },
      auctionId,
      // A default owner is unique per run, so a second run in this process gets `busy`.
      this.explicitOwner ? this.owner : runLeaseOwner(this.owner),
      async (renew) => {
        const journal = await this.deps.journals.load(auctionId);
        if (journal === null) throw new Error(`no settlement for auction ${auctionId}`);
        return new Run(this.deps, journal, renew).drive();
      },
    );
    return leased.status === 'busy' ? { status: 'busy' } : leased.value;
  }
}

interface Target {
  bidderId: string;
  holdId: string;
  authId: string;
  price: number;
  invoiceId: string;
  truth: { holdId: string; authId: string; orderId?: string };
}

/** One run of the phase: the journal as last saved, and the steps that move it. */
class Run {
  private readonly deadlineMs: number;

  constructor(
    private readonly deps: CaptureDeps,
    private j: Journal,
    private readonly renew: () => Promise<void>,
  ) {
    this.deadlineMs = deps.unknownDeadlineMs ?? DEFAULT_UNKNOWN_DEADLINE_MS;
  }

  private now(): number {
    return this.deps.clock.nowMs();
  }

  private async boundary(label: string): Promise<void> {
    await this.deps.boundary?.(label);
  }

  /** One state transition: step, compare-and-set save, audit. */
  private async apply(event: SettlementEvent): Promise<Journal> {
    await this.renew();
    const from = this.j;
    const next = step(from, event).journal;
    await this.deps.journals.save(next, from.version);
    this.j = next;
    this.deps.metrics?.incr('settlement_transitions_total', { to: next.state });
    await this.deps.audit.append({
      kind: 'state_change',
      auctionId: next.auctionId,
      from: from.state,
      to: next.state,
      label: event.label ?? `journaled:${event.type}`,
      tsMs: event.tsMs,
    });
    await this.boundary(`journaled:${event.type}`);
    return next;
  }

  /** A save that is not a transition: the write-ahead intent, unknownSince. */
  private async patch(label: string, change: (draft: Journal) => void): Promise<Journal> {
    await this.renew();
    const from = this.j;
    const next = structuredClone(from);
    change(next);
    next.version = from.version + 1;
    await this.deps.journals.save(next, from.version);
    this.j = next;
    await this.boundary(`journaled:${label}`);
    return next;
  }

  private ev(type: SettlementEvent['type']): SettlementEvent {
    return { type, tsMs: this.now() } as SettlementEvent;
  }

  async drive(): Promise<CaptureOutcome> {
    // The settlement is created at the hammer; record the two lifecycle steps.
    if (this.j.state === 'HELD') await this.apply(this.ev('start_auction'));
    if (this.j.state === 'BIDDING') await this.apply(this.ev('hammer'));
    if (this.j.state === 'WINNER_SELECTED') {
      await this.apply(this.ev(this.j.plan.candidates.length === 0 ? 'no_candidate' : 'begin'));
    }
    for (;;) {
      const done = terminal(this.j);
      if (done !== null) return done;
      if (this.j.state === 'FALLBACK_RUNNER_UP') {
        const more = this.j.cursor + 1 < this.j.plan.candidates.length;
        await this.apply(this.ev(more ? 'next_candidate' : 'no_candidates_left'));
        continue;
      }
      const result = await this.attempt();
      if (result !== null) return result;
    }
  }

  /**
   * One pass over the candidate at the cursor. Returns an outcome when the phase
   * is over for now, or null after a transition that leaves more to do.
   */
  private async attempt(): Promise<CaptureOutcome | null> {
    const { gateway } = this.deps;
    const j = this.j;
    const cand = j.plan.candidates[j.cursor];
    const hold = cand === undefined ? undefined : j.holds[cand.bidderId];
    if (cand === undefined || hold === undefined) return this.fail('invariant');

    // R-PAY-052: before any PayPal call.
    const price = cand.priceCents;
    if (!Number.isSafeInteger(price) || price <= 0 || price > hold.ceilingCents) {
      return this.fail('invariant');
    }
    if (price < j.plan.reserveCents) return this.definiteFail(cand.bidderId, 'below_reserve');

    const target: Target = {
      bidderId: cand.bidderId,
      holdId: hold.holdId,
      authId: hold.authId,
      price,
      invoiceId: invoiceIdFor(j.auctionId, hold.holdId),
      truth: truthArgs(hold),
    };

    // R-PAY-050: truth before capture. A capture already there is adopted.
    const truth = await this.readTruth(target);
    if (truth !== undefined) {
      const out = await this.judge(truth, target, null);
      if (out !== undefined) return out;
    }

    // R-PAY-063: no new capture (checked first: no retry is possible, so the unknown clock must not fire) while the kill switch is engaged.
    if (this.deps.killSwitch !== undefined && (await this.deps.killSwitch.isEngaged()).engaged) {
      return { status: 'pending', reason: 'kill_switch', journal: j };
    }

    // R-PAY-055: the outcome has been unknown for too long.
    if (unknownExpired(j.unknownSince, this.now(), this.deadlineMs)) {
      return this.fail('unknown_deadline');
    }
    if (truth === undefined) return { status: 'pending', reason: 'truth_unavailable', journal: j };

    // Write-ahead intent; a resume reuses the saved one, so the request id repeats.
    const saved = j.intent;
    if (saved === null || saved.op !== 'capture' || saved.holdId !== target.holdId) {
      const requestId = buildRequestId({
        auctionId: j.auctionId,
        op: 'capture',
        holdId: target.holdId,
        amountCents: price,
        generation: 0,
      });
      const startedAtMs = this.now();
      await this.patch('intent', (d) => {
        d.intent = {
          op: 'capture',
          holdId: target.holdId,
          requestId,
          amountCents: price,
          startedAtMs,
        };
      });
    }
    const requestId = this.j.intent?.requestId;
    if (requestId === undefined) throw new Error('capture intent missing after save');

    await this.renew();
    let captured: { captureId: string; amountCents: number } | undefined;
    let failure: PayPalError | undefined;
    try {
      await this.boundary('before:capture');
      captured = await gateway.capture(target.authId, {
        amountCents: price,
        finalCapture: true,
        invoiceId: target.invoiceId,
        requestId,
      });
      await this.boundary('after:capture');
    } catch (e) {
      if (!(e instanceof PayPalError)) throw e;
      failure = e;
    }
    await this.auditCall(target, requestId, captured, failure);

    if (captured !== undefined) {
      if (captured.amountCents !== price) return this.fail('mismatch');
      return this.won(target, captured.captureId, 'capture_ok');
    }
    return this.afterFailure(failure as PayPalError, target);
  }

  private async readTruth(t: Target): Promise<HoldTruth | undefined> {
    try {
      await this.boundary('before:get');
      const truth = await this.deps.gateway.getHoldTruth(t.truth);
      await this.boundary('after:get');
      return truth;
    } catch (e) {
      if (e instanceof PayPalError) return undefined;
      throw e;
    }
  }

  /**
   * Acts on a truth reading: adopt a matching capture, stop on a capture that
   * does not match, or fall back when the hold is gone. undefined means the hold
   * is open and untouched. `after` is the failed capture error, if any.
   */
  private async judge(
    truth: HoldTruth,
    t: Target,
    after: PayPalError | null,
  ): Promise<CaptureOutcome | null | undefined> {
    const v = verdict(truth, t.price, t.invoiceId);
    switch (v.kind) {
      case 'adopt':
        return this.won(t, v.capture.captureId, 'adopted', v.capture.amountCents);
      case 'mismatch':
        return this.fail('mismatch');
      case 'gone':
        return this.definiteFail(t.bidderId, after?.kind ?? v.why);
      case 'open':
        return undefined;
    }
  }

  private async afterFailure(err: PayPalError, t: Target): Promise<CaptureOutcome | null> {
    const j = this.j;
    if (err.kind === 'kill_switch_engaged') {
      return { status: 'pending', reason: 'kill_switch', journal: j };
    }
    if (
      err.kind === 'auth_unavailable' ||
      err.kind === 'auth_failed' ||
      err.kind === 'auth_expired'
    ) {
      // Nothing was sent: the winner is not charged and not failed. Retry later with the same intent.
      return { status: 'pending', reason: 'auth_unavailable', journal: j };
    }
    if (err.outcome === 'unknown') {
      // R-PAY-054: never the next candidate. Remember when it started.
      if (j.unknownSince === null) {
        const since = this.now();
        await this.patch('unknown_since', (d) => {
          d.unknownSince = since;
        });
      }
      return { status: 'pending', reason: 'capture_outcome_unknown', journal: this.j };
    }
    if (INVARIANT_KINDS.has(err.kind)) return this.fail('invariant');
    if (!PER_HOLD_KINDS.has(err.kind)) {
      // Unclassified refusal: keep the intent, surface it, and let the unknown deadline
      // send it to review. Never the next candidate.
      if (j.unknownSince === null) {
        const since = this.now();
        await this.patch('unknown_since', (d) => {
          d.unknownSince = since;
        });
      }
      return { status: 'pending', reason: 'capture_rejected_unclassified', journal: this.j };
    }

    // R-PAY-053: a definite refusal falls back only after the truth says not captured.
    let truth: HoldTruth;
    try {
      truth = await this.deps.gateway.getHoldTruth(t.truth);
    } catch (e) {
      if (!(e instanceof PayPalError)) throw e;
      return { status: 'pending', reason: 'truth_unavailable', journal: j };
    }
    const out = await this.judge(truth, t, err);
    if (out !== undefined) return out;
    if (err.kind === 'already_captured') return this.fail('mismatch');
    return this.definiteFail(t.bidderId, err.kind);
  }

  private async won(
    t: Target,
    captureId: string,
    type: 'capture_ok' | 'adopted',
    amountCents: number = t.price,
  ): Promise<CaptureOutcome> {
    const journal = await this.apply({
      type,
      tsMs: this.now(),
      winner: { bidderId: t.bidderId, holdId: t.holdId, captureId, amountCents },
    });
    return { status: 'captured', journal };
  }

  private async definiteFail(bidderId: string, reason: string): Promise<null> {
    await this.apply({ type: 'definite_fail', tsMs: this.now(), failure: { bidderId, reason } });
    return null;
  }

  private async fail(kind: 'invariant' | 'mismatch' | 'unknown_deadline'): Promise<CaptureOutcome> {
    // R-PAY-055: the review reason of an unknown outcome is named after the outcome.
    const reason = kind === 'unknown_deadline' ? UNKNOWN_REVIEW_REASON : kind;
    const event =
      kind === 'unknown_deadline'
        ? { ...this.ev(kind), label: `journaled:${reason}` }
        : this.ev(kind);
    const journal = await this.apply(event);
    return { status: 'failed', reason, journal };
  }

  private async auditCall(
    t: Target,
    requestId: string,
    ok: { captureId: string } | undefined,
    err: PayPalError | undefined,
  ): Promise<void> {
    await this.deps.audit.append({
      kind: 'paypal_call',
      auctionId: this.j.auctionId,
      holdId: t.holdId,
      op: 'capture',
      requestId,
      outcome: ok !== undefined ? 'definite' : (err?.outcome ?? 'unknown'),
      status: ok !== undefined ? 201 : (err?.status ?? 0),
      ...(err?.debugId === undefined ? {} : { debugId: err.debugId }),
      label: ok !== undefined ? 'ok' : (err?.kind ?? 'error'),
      tsMs: this.now(),
    });
  }
}

/** Reads a truth against the capture this settlement wants (R-PAY-050, R-PAY-061). */
export function verdict(truth: HoldTruth, priceCents: number, invoiceId: string): Verdict {
  if (FAILED_TRUTH.has(truth.status))
    return { kind: 'gone', why: `hold_${truth.status.toLowerCase()}` };
  if (truth.captures === null) {
    // Not observable: a captured hold cannot be matched to this candidate.
    return truth.status === 'CAPTURED' || truth.status === 'PARTIALLY_CAPTURED'
      ? { kind: 'mismatch', why: 'captures not observable' }
      : { kind: 'open' };
  }
  if (truth.captures.length === 0) {
    return truth.capturedCents > 0
      ? { kind: 'mismatch', why: 'untracked capture' }
      : { kind: 'open' };
  }
  if (truth.captures.some((c) => c.refund !== undefined)) {
    // Money was taken and returned: never open, never adopted, never captured again.
    return { kind: 'mismatch', why: 'capture refunded' };
  }
  const ours = truth.captures.filter(
    (c) =>
      c.final &&
      c.amountCents === priceCents &&
      (c.invoiceId === undefined || c.invoiceId === invoiceId),
  );
  const [only] = ours;
  if (ours.length === 1 && truth.captures.length === 1 && only !== undefined) {
    return { kind: 'adopt', capture: only };
  }
  return { kind: 'mismatch', why: 'captures differ from the plan' };
}

/** Runs, or resumes, the capture phase of one settlement. */
export function runCapturePhase(deps: CaptureDeps, auctionId: string): Promise<CaptureOutcome> {
  return new CapturePhase(deps).run(auctionId);
}
