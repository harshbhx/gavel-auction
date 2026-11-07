import { PayPalError } from '../errors.js';
import type { AuditSink, Clock, JournalStore, KillSwitch, PaymentsGateway } from '../ports.js';
import type { PaymentsMetrics } from '../ports.js';
import { buildRequestId } from '../requestId.js';
import type { CaptureRef, HoldTruth, Journal, KillState } from '../types.js';
import { withLease } from './create.js';
import { truthArgs } from './truth.js';
import { defaultLeaseOwner, runLeaseOwner } from './owner.js';
import { step, type SettlementEvent } from './machine.js';
import { auditedThrough, recoverTrail, stateChangeRow } from './trail.js';
import {
  DEFAULT_PENDING_CAPTURE_DEADLINE_MS,
  DEFAULT_UNKNOWN_DEADLINE_MS,
  UNKNOWN_REVIEW_REASON,
  unknownExpired,
} from './unknown.js';

export { DEFAULT_PENDING_CAPTURE_DEADLINE_MS, DEFAULT_UNKNOWN_DEADLINE_MS };

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
 * A capture PayPal lists as PENDING is not adopted (R11-O03): the phase waits with the
 * intent until PayPal reports it COMPLETED (adopt) or declines it (fall back). Once PayPal
 * has reported it PENDING it waits under the pending-capture deadline (default three days),
 * not the ten-minute deadline of a lost answer (R12-P01).
 *
 * While the kill switch is engaged no capture can be retried, so the unknown clock stands
 * still: the time it held is added to `unknownSince` on the first run after the release
 * (R4-S05, R12-P05).
 *
 * A wait that nothing ends by itself is reported (RT4-saga-03): when the truth read or the
 * OAuth token keeps failing for longer than the unknown deadline, and when PayPal keeps a
 * capture PENDING for longer than it, one `settlement_alert` (audit and metric) is raised.
 * The phase keeps waiting; nothing is sent to review or released for it. A capture adopted
 * from the truth on a resume writes the `paypal_call` row of the request that took the money,
 * so a crash between the capture and its audit row cannot lose it (RT4-saga-04).
 *
 * Every state change is one compare-and-set save of the journal before the next
 * effect. The runner holds the auction's lease and renews it before each step. Its
 * `state_change` row is written after the save and is recovered from the journal history
 * when a crash came in between (trail.ts).
 * Voiding the other holds is the next phase and is not done here.
 *
 * UNVERIFIED (G1): that the order lists captures with their invoice id. When the
 * truth cannot list captures but reports the hold as captured, the capture cannot
 * be identified and the settlement goes to FAILED_NEEDS_REVIEW instead of guessing.
 */

export type PendingReason =
  | 'capture_outcome_unknown'
  /** PayPal lists the capture as PENDING: not adopted until it is COMPLETED (R11-O03). */
  | 'capture_pending'
  | 'kill_switch'
  | 'truth_unavailable'
  | 'auth_unavailable'
  /** PayPal refused to run the capture (HTTP 429): nothing was applied, retried later. */
  | 'rate_limited'
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
  /**
   * How long a capture PayPal reported PENDING is waited for before the settlement goes
   * to review (R12-P01). Default three days.
   */
  pendingCaptureDeadlineMs?: number;
  /**
   * Lease owner prefix. Every run adds a fresh random suffix to it (R7P03, R11-O05), so two
   * runs never share a lease. Default: the process id.
   */
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

/** Errors that mean no OAuth token could be had: nothing was sent to PayPal. */
const AUTH_KINDS: ReadonlySet<string> = new Set([
  'auth_unavailable',
  'auth_failed',
  'auth_expired',
]);

/**
 * `voids` key holding when the phase first could not read the truth or get a token
 * (RT4-saga-03); never a bidder id. The void phase's alert markers use `alerted:`.
 */
const STALLED_SINCE = 'stalled_since:capture';
const ALERTED = 'alerted:';

type StallReason = 'truth_unavailable' | 'auth_unavailable' | 'rate_limited';

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
  /** Our capture is listed but PENDING: neither taken nor refused yet (R11-O03). */
  | { kind: 'in_doubt' }
  | { kind: 'mismatch'; why: string }
  | { kind: 'gone'; why: string }
  | { kind: 'open' };

export class CapturePhase {
  private readonly owner: string;

  constructor(private readonly deps: CaptureDeps) {
    this.owner = deps.owner ?? defaultLeaseOwner('runner');
  }

  /** Runs, or resumes, the capture phase of one settlement. */
  async run(auctionId: string): Promise<CaptureOutcome> {
    const leased = await withLease(
      { journals: this.deps.journals, clock: this.deps.clock },
      auctionId,
      // Every run gets its own owner, also under a configured one (R11-O05): a second run
      // or a voidAll in this process gets `busy` and cannot free this run's lease.
      runLeaseOwner(this.owner),
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
  private readonly pendingDeadlineMs: number;
  /** The history seq through which this run knows the `state_change` rows written. */
  private audited: number;

  constructor(
    private readonly deps: CaptureDeps,
    private j: Journal,
    private readonly renew: () => Promise<void>,
  ) {
    this.deadlineMs = deps.unknownDeadlineMs ?? DEFAULT_UNKNOWN_DEADLINE_MS;
    this.pendingDeadlineMs = deps.pendingCaptureDeadlineMs ?? DEFAULT_PENDING_CAPTURE_DEADLINE_MS;
    this.audited = auditedThrough(j);
  }

  private now(): number {
    return this.deps.clock.nowMs();
  }

  /**
   * The deadline of the outcome in doubt: a capture PayPal reported PENDING is PayPal
   * deciding and waits longer than an answer that was lost (R12-P01).
   */
  private deadline(): number {
    const i = this.j.intent;
    return i !== null && i.op === 'capture' && i.pendingSinceMs !== undefined
      ? this.pendingDeadlineMs
      : this.deadlineMs;
  }

  private async killState(): Promise<KillState> {
    return this.deps.killSwitch === undefined
      ? { engaged: false }
      : this.deps.killSwitch.isEngaged();
  }

  private async boundary(label: string): Promise<void> {
    await this.deps.boundary?.(label);
  }

  /**
   * One state transition: step, compare-and-set save, audit. The save records the rows
   * written so far, so a crash before this row is appended leaves it to the next run.
   */
  private async apply(event: SettlementEvent): Promise<Journal> {
    await this.renew();
    const from = this.j;
    const next = step(from, event).journal;
    next.auditedSeq = this.audited;
    await this.deps.journals.save(next, from.version);
    this.j = next;
    this.deps.metrics?.incr('settlement_transitions_total', { to: next.state });
    const entry = next.history[next.history.length - 1];
    if (entry !== undefined) {
      await this.deps.audit.append(stateChangeRow(next.auctionId, entry));
      this.audited = entry.seq;
    }
    await this.boundary(`journaled:${event.type}`);
    return next;
  }

  /** A save that is not a transition: the write-ahead intent, unknownSince. */
  private async patch(label: string, change: (draft: Journal) => void): Promise<Journal> {
    await this.renew();
    const from = this.j;
    const next = structuredClone(from);
    change(next);
    if (this.audited > auditedThrough(from)) next.auditedSeq = this.audited;
    next.version = from.version + 1;
    await this.deps.journals.save(next, from.version);
    this.j = next;
    await this.boundary(`journaled:${label}`);
    return next;
  }

  /**
   * RT4-saga-04: the run first writes the rows a crash after an earlier save lost, and ends
   * by saving how far the rows are written when its last save came before a row.
   */
  async drive(): Promise<CaptureOutcome> {
    this.audited = await recoverTrail(this.deps.audit, this.j);
    const out = await this.steps();
    if (this.audited <= auditedThrough(this.j)) return out;
    await this.patch('audited', () => undefined);
    return out.status === 'busy' ? out : { ...out, journal: this.j };
  }

  private ev(type: SettlementEvent['type']): SettlementEvent {
    return { type, tsMs: this.now() } as SettlementEvent;
  }

  private async steps(): Promise<CaptureOutcome> {
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
    // HRD-46: a saved capture intent for this hold means a capture may already have been
    // sent (a lost answer, a crash after the call), so its outcome is not known.
    const inDoubt =
      j.intent !== null && j.intent.op === 'capture' && j.intent.holdId === hold.holdId;

    // R-PAY-050: truth before capture. A capture already there is adopted.
    const truth = await this.readTruth(target);
    // R12-P05: the time the kill switch held the unknown clock is taken off before any
    // deadline is judged. The switch only stops a new capture (below): a capture that is
    // already there is adopted while it is engaged.
    const kill = await this.killState();
    if (!kill.engaged) await this.resumeUnknownClock();
    // HRD-46: PayPal not finding the hold says nothing about a capture in doubt on it. It
    // is no answer: the intent stays, no other candidate is tried, and the unknown
    // deadline sends the settlement to review with this hold kept.
    const unseen = inDoubt && truth?.status === 'NOT_FOUND';
    if (unseen) await this.startUnknownClock();
    // A truth that cannot be read is no answer either (a 404 the order does not confirm,
    // credentials for another account, an outage). A crash right after the capture call
    // leaves the intent saved but not the clock, so the clock starts here too: otherwise
    // the run would wait for a readable truth forever instead of reaching review under the
    // unknown deadline (the pending-capture deadline once PayPal listed it PENDING).
    if (inDoubt && truth === undefined) await this.startUnknownClock();
    if (truth !== undefined && !unseen) {
      const out = await this.judge(truth, target, null);
      if (out !== undefined) return out;
    }

    // R-PAY-063: no new capture while the kill switch is engaged. Checked before the
    // deadline: no retry is possible, so the unknown clock stands still (R4-S05, R12-P05).
    if (kill.engaged) return this.pauseUnknownClock(kill.sinceMs);

    // R-PAY-055: the outcome has been unknown for too long.
    if (unknownExpired(this.j.unknownSince, this.now(), this.deadline())) {
      return this.fail('unknown_deadline');
    }
    if (unseen) return { status: 'pending', reason: 'capture_outcome_unknown', journal: this.j };
    if (truth === undefined) return this.stalled('truth_unavailable', target);

    // Write-ahead intent; a resume reuses the saved one, so the request id repeats.
    const saved = this.j.intent;
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
    // PayPal answered the capture: the truth and the token work again.
    if (
      failure === undefined ||
      !(AUTH_KINDS.has(failure.kind) || failure.kind === 'rate_limited')
    ) {
      await this.unstalled();
    }

    if (captured !== undefined) {
      if (captured.amountCents !== price) return this.fail('mismatch');
      return this.won(target, captured.captureId, 'capture_ok');
    }
    return this.afterFailure(failure as PayPalError, target, inDoubt);
  }

  /** Starts the unknown clock if it is not running (R-PAY-054). */
  private async startUnknownClock(): Promise<void> {
    if (this.j.unknownSince !== null) return;
    const since = this.now();
    await this.patch('unknown_since', (d) => {
      d.unknownSince = since;
    });
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
      case 'in_doubt':
        return this.waitForPendingCapture(t);
      case 'mismatch':
        return this.fail('mismatch');
      case 'gone':
        return this.definiteFail(t.bidderId, after?.kind ?? v.why);
      case 'open':
        return undefined;
    }
  }

  /**
   * R11-O03: PayPal lists our capture as PENDING. It is neither the sale nor a failure:
   * the intent stays, no other candidate is tried and the void phase does not start, so
   * the next candidates keep their holds. A later run adopts it once PayPal says
   * COMPLETED, or falls back once PayPal declined it. The pending-capture deadline applies
   * (R12-P01, default three days): only a capture that stays pending that long goes to
   * review, with its hold kept.
   */
  private async waitForPendingCapture(t: Target): Promise<CaptureOutcome> {
    await this.markPending(t.holdId);
    if (unknownExpired(this.j.unknownSince, this.now(), this.deadline())) {
      return this.fail('unknown_deadline');
    }
    await this.alertIfPendingLong(t);
    return { status: 'pending', reason: 'capture_pending', journal: this.j };
  }

  /**
   * RT4-saga-03: a capture PayPal keeps PENDING past the deadline of a lost answer is still
   * waited for (R12-P01), but an operator is told once per candidate.
   */
  private async alertIfPendingLong(t: Target): Promise<void> {
    if (unknownExpired(this.j.unknownSince, this.now(), this.deadlineMs)) {
      await this.alertOnce(`capture_pending:${t.bidderId}`, t.holdId);
    }
  }

  /**
   * RT4-saga-03: the truth cannot be read or no OAuth token can be had, so nothing can be
   * decided. The first such run saves when it started; once that is older than the unknown
   * deadline one `settlement_alert` is raised. The phase keeps waiting either way: nothing
   * was sent, so nothing is in doubt and no hold is released for it.
   */
  private async stalled(reason: StallReason, t: Target): Promise<CaptureOutcome> {
    const raw = this.j.voids[STALLED_SINCE];
    const since = raw === undefined ? NaN : Number(raw);
    const now = this.now();
    if (!Number.isFinite(since)) {
      await this.patch('stalled_since', (d) => {
        d.voids[STALLED_SINCE] = String(now);
      });
    } else if (unknownExpired(since, now, this.deadlineMs)) {
      await this.alertOnce(`${reason}:${t.bidderId}`, t.holdId);
    }
    return { status: 'pending', reason, journal: this.j };
  }

  /** PayPal answered again: a later outage starts its own clock. */
  private async unstalled(): Promise<void> {
    if (this.j.voids[STALLED_SINCE] === undefined) return;
    await this.patch('stalled_cleared', (d) => {
      d.voids = Object.fromEntries(Object.entries(d.voids).filter(([k]) => k !== STALLED_SINCE));
    });
  }

  /**
   * Tells an operator once (audit entry and metric), then saves a `voids` marker so later
   * runs stay quiet. The entry is written before the marker: a crash between them repeats
   * the alert, never loses it (as the void phase's alerts, R12-P02).
   */
  private async alertOnce(reason: string, holdId: string): Promise<void> {
    const marker = `${ALERTED}${reason}`;
    if (this.j.voids[marker] !== undefined) return;
    const now = this.now();
    const [kind = reason] = reason.split(':');
    this.deps.metrics?.incr('settlement_alerts_total', { reason: kind });
    await this.deps.audit.append({
      kind: 'settlement_alert',
      auctionId: this.j.auctionId,
      holdId,
      label: reason,
      tsMs: now,
    });
    await this.patch('alert', (d) => {
      d.voids[marker] = String(now);
    });
  }

  /**
   * Saves that PayPal holds our capture on `holdId` as PENDING (R12-P01): starts the clock
   * if it is not running and marks the intent, so every later deadline check of this
   * capture uses the pending-capture deadline. Done once.
   */
  private async markPending(holdId: string): Promise<void> {
    const ours = (i: Journal['intent']): boolean =>
      i !== null && i.op === 'capture' && i.holdId === holdId && i.pendingSinceMs === undefined;
    if (this.j.unknownSince !== null && !ours(this.j.intent)) return;
    const now = this.now();
    await this.patch('capture_pending', (d) => {
      if (d.unknownSince === null) d.unknownSince = now;
      if (d.intent !== null && ours(d.intent)) d.intent.pendingSinceMs = now;
    });
  }

  /**
   * R-PAY-063, R12-P05: the kill switch is engaged, so no capture can be retried. The
   * unknown clock stops at the time the switch was engaged (never before the outcome
   * became unknown) and starts again on the first run after the release.
   */
  private async pauseUnknownClock(engagedAtMs: number | undefined): Promise<CaptureOutcome> {
    const since = this.j.unknownSince;
    if (since !== null && this.j.unknownPausedAtMs === undefined) {
      const now = this.now();
      const at = Math.min(now, Math.max(since, engagedAtMs ?? now));
      await this.patch('unknown_paused', (d) => {
        d.unknownPausedAtMs = at;
      });
    }
    return { status: 'pending', reason: 'kill_switch', journal: this.j };
  }

  /** R12-P05: the switch is released; the time it held the clock is not counted. */
  private async resumeUnknownClock(): Promise<void> {
    const paused = this.j.unknownPausedAtMs;
    if (paused === undefined) return;
    const held = Math.max(0, this.now() - paused);
    await this.patch('unknown_resumed', (d) => {
      if (d.unknownSince !== null) d.unknownSince += held;
      delete d.unknownPausedAtMs;
    });
  }

  /**
   * `inDoubt`: a capture intent for this hold was saved before this run's call, so an
   * earlier capture may have reached PayPal (HRD-46).
   */
  private async afterFailure(
    err: PayPalError,
    t: Target,
    inDoubt: boolean,
  ): Promise<CaptureOutcome | null> {
    if (err.kind === 'kill_switch_engaged') {
      // Engaged after this run looked: nothing was sent, and the clock stops as above.
      const kill = await this.killState();
      return this.pauseUnknownClock(kill.engaged ? kill.sinceMs : undefined);
    }
    if (AUTH_KINDS.has(err.kind)) {
      // Nothing was sent: the winner is not charged and not failed. Retry later with the same intent.
      return this.stalled('auth_unavailable', t);
    }
    if (err.kind === 'rate_limited') {
      // HTTP 429: PayPal refused to run the request, so this call applied nothing and no
      // unknown clock starts for it (a restart must not age it into review). The intent
      // stays; the next pass reads the truth first and retries with the same request id.
      // A 429 that follows an earlier ambiguous attempt leaves that attempt's clock as it is.
      return this.stalled('rate_limited', t);
    }
    if (err.outcome === 'unknown') {
      if (err.name === 'CAPTURE_PENDING') {
        // R11-O03, R12-P01: PayPal took the capture and decides on it later. Not a lost
        // answer: it waits under the pending-capture deadline.
        await this.markPending(t.holdId);
        await this.alertIfPendingLong(t);
        return { status: 'pending', reason: 'capture_pending', journal: this.j };
      }
      // R-PAY-054: never the next candidate. Remember when it started.
      await this.startUnknownClock();
      return { status: 'pending', reason: 'capture_outcome_unknown', journal: this.j };
    }
    if (INVARIANT_KINDS.has(err.kind)) return this.fail('invariant');
    if (!PER_HOLD_KINDS.has(err.kind)) {
      // Unclassified refusal: keep the intent, surface it, and let the unknown deadline
      // send it to review. Never the next candidate.
      await this.startUnknownClock();
      return { status: 'pending', reason: 'capture_rejected_unclassified', journal: this.j };
    }

    // R-PAY-053: a definite refusal falls back only after the truth says not captured.
    let truth: HoldTruth;
    try {
      truth = await this.deps.gateway.getHoldTruth(t.truth);
    } catch (e) {
      if (!(e instanceof PayPalError)) throw e;
      return this.stalled('truth_unavailable', t);
    }
    if (inDoubt && truth.status === 'NOT_FOUND') {
      // HRD-46: an earlier capture on this hold may have been taken; a hold PayPal cannot
      // find is no proof that it was not. Never the next candidate.
      await this.startUnknownClock();
      return { status: 'pending', reason: 'capture_outcome_unknown', journal: this.j };
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
    if (type === 'adopted') await this.auditAdopted(t);
    const journal = await this.apply({
      type,
      tsMs: this.now(),
      winner: { bidderId: t.bidderId, holdId: t.holdId, captureId, amountCents },
    });
    return { status: 'captured', journal };
  }

  private async definiteFail(bidderId: string, reason: string): Promise<null> {
    // The next candidate's wait, if any, starts its own clock.
    await this.unstalled();
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

  /**
   * RT4-saga-04: a capture adopted from the truth was taken by our saved request, whose
   * answer was lost, possibly with its audit row (a crash right after the call). That row is
   * written now, before the transition is saved, so a crash cannot lose the money call. At
   * least once: when the row was written before the crash this one repeats it, labelled
   * `adopted`.
   */
  private async auditAdopted(t: Target): Promise<void> {
    const i = this.j.intent;
    if (i === null || i.op !== 'capture' || i.holdId !== t.holdId) return;
    await this.deps.audit.append({
      kind: 'paypal_call',
      auctionId: this.j.auctionId,
      holdId: t.holdId,
      op: 'capture',
      requestId: i.requestId,
      outcome: 'definite',
      label: 'adopted',
      tsMs: this.now(),
    });
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
  const isOurs = (c: CaptureRef): boolean =>
    c.final &&
    c.amountCents === priceCents &&
    (c.invoiceId === undefined || c.invoiceId === invoiceId);
  if (truth.captures.length === 0) {
    if (truth.capturedCents > 0) return { kind: 'mismatch', why: 'untracked capture' };
    // R11-O03: PayPal declined our capture after it was pending. Nothing was taken: this
    // candidate failed for good, so the settlement falls back.
    if ((truth.declined ?? []).some(isOurs)) return { kind: 'gone', why: 'capture_declined' };
    return { kind: 'open' };
  }
  if (truth.captures.some((c) => c.refund !== undefined)) {
    // Money was taken and returned: never open, never adopted, never captured again.
    return { kind: 'mismatch', why: 'capture refunded' };
  }
  const ours = truth.captures.filter(isOurs);
  const [only] = ours;
  if (ours.length === 1 && truth.captures.length === 1 && only !== undefined) {
    // R11-O03: a PENDING capture is not money taken; wait until PayPal completes it.
    return only.pending === true ? { kind: 'in_doubt' } : { kind: 'adopt', capture: only };
  }
  return { kind: 'mismatch', why: 'captures differ from the plan' };
}

/** Runs, or resumes, the capture phase of one settlement. */
export function runCapturePhase(deps: CaptureDeps, auctionId: string): Promise<CaptureOutcome> {
  return new CapturePhase(deps).run(auctionId);
}
