import { PayPalError } from '../errors.js';
import type { AuditSink, Clock, JournalStore, PaymentsGateway } from '../ports.js';
import type { PaymentsMetrics } from '../ports.js';
import { buildRequestId } from '../requestId.js';
import type { HoldTruth, Journal, JournalHold, SettlementState } from '../types.js';
import { runCapturePhase, type CaptureDeps, type CaptureOutcome } from './capture.js';
import { defaultLeaseOwner, runLeaseOwner } from './owner.js';
import { withLease } from './create.js';
import { truthArgs } from './truth.js';
import { step, type SettlementEvent } from './machine.js';
import { DEFAULT_UNKNOWN_DEADLINE_MS, unknownExpired } from './unknown.js';
import {
  releaseWinnerRemainder,
  remainderKey,
  type RemainderMode,
  type RemainderResult,
} from './remainder.js';

/**
 * Void and release phase of the settlement runner (SPEC 3.5; R-PAY-057, R-PAY-058,
 * R-PAY-059, R-PAY-062). From CAPTURED (a sale) or VOIDING (no sale) to SETTLED:
 *
 *   CAPTURED: check the winner's remainder (remainder.ts), then begin_void
 *   VOIDING:  void every hold except the winner's, sorted by bidder id, with
 *             bounded concurrency (default 3) and serialized journal writes
 *   all released -> SETTLED
 *
 * Every hold has one deterministic request id, so a retry or a resume repeats the
 * same call and PayPal answers it once. A void answered "already voided" or
 * "expired" counts as released. Any other failure is checked against the hold
 * truth; a hold that is still live is retried once and then recorded VOID_FAILED
 * (or `pending` when the outcome is unknown) and retried on the next run. Each
 * run that finds a VOID_FAILED hold uses one resume; after `maxVoidResumes` the
 * settlement goes to FAILED_NEEDS_REVIEW with reason `void_failed:<bidderId>`. A
 * `pending` hold is retried on every run and does not use the budget, but the journal
 * records when it first became pending (`pending_since:<bidderId>`). Every run retries
 * the pending voids before it looks at that age (R12-P02). A no sale whose void is still
 * pending after the unknown deadline goes to FAILED_NEEDS_REVIEW with reason
 * `void_unconfirmed:<bidderId>`. A sale does not: the winner has paid, so a slow release
 * never ends it in review. It raises one `settlement_alert` (audit and metric) with that
 * reason and keeps retrying until PayPal answers; the same holds for a winner's remainder
 * that stays unreadable (`remainder_unconfirmed`). Voids are not
 * blocked by the kill switch (R-PAY-006, R-PAY-063).
 *
 * While the capture phase waits (kill switch, a PENDING capture, PayPal reads or OAuth
 * failing) a run releases the holds no candidate can be charged on any more (RT4-saga-03):
 * bidders outside the plan's candidates and candidates that already failed for good. The
 * hold of a capture in flight and the holds of the candidate at the cursor and of every
 * candidate after it are kept, so the winner and the runner-up fallback are untouched.
 *
 * The journal keeps one entry per bidder in `voids`: voided, released,
 * VOID_FAILED or pending. The winner's remainder is kept under `remainder:<id>`.
 */

export const DEFAULT_VOID_CONCURRENCY = 3;
export const DEFAULT_MAX_VOID_RESUMES = 5;
/** Reads of the winner's authorization before a mismatch is believed. */
const MISMATCH_READS = 3;

export type VoidStatus = 'voided' | 'released' | 'VOID_FAILED' | 'pending';

const PENDING_SINCE = 'pending_since:';
const REMAINDER_SINCE = 'remainder_since:';
/** `voids` key prefix of an alert already raised (R12-P02); never a bidder id. */
const ALERTED = 'alerted:';

const DONE: ReadonlySet<string> = new Set<VoidStatus>(['voided', 'released']);
const RELEASED_KINDS: ReadonlySet<string> = new Set(['already_voided', 'expired']);
const CAPTURED_TRUTH: ReadonlySet<HoldTruth['status']> = new Set([
  'CAPTURED',
  'PARTIALLY_CAPTURED',
]);
/**
 * Truth that proves a hold released. NOT_FOUND is not in it (HRD-46): a hold PayPal cannot
 * find may still be live under another account or after a misrouted read, so it is never
 * recorded released.
 */
const GONE_TRUTH: ReadonlySet<HoldTruth['status']> = new Set(['VOIDED', 'EXPIRED']);

export interface VoidCallDeps {
  gateway: PaymentsGateway;
  audit: AuditSink;
  clock: Clock;
  boundary?: (label: string) => Promise<void> | void;
}

export interface VoidDeps extends VoidCallDeps {
  journals: JournalStore;
  metrics?: PaymentsMetrics;
  /** Default 3 (R-PAY-057). */
  voidConcurrency?: number;
  /** Default 5 (R-PAY-058). */
  maxVoidResumes?: number;
  /** How long a pending void or an unavailable remainder is retried. Default ten minutes. */
  unknownDeadlineMs?: number;
  /** How long a review keeps the next candidates' holds before they are released. Default 24 hours. */
  reviewHoldMaxAgeMs?: number;
  /** Operator release (R9-M04): a run of a settlement in review voids every hold, candidates included. */
  releaseAllReviewHolds?: boolean;
  /** Lease owner prefix; every run adds its own random suffix (R11-O05). Default: the process id. */
  owner?: string;
  /** G1 decision for the winner's remainder (R-PAY-059, R12-P06). Default A, as recorded. */
  remainderMode?: RemainderMode;
}

export type VoidOutcome =
  | { status: 'settled'; journal: Journal }
  | {
      status: 'pending';
      reason: 'void_incomplete' | 'remainder_unavailable' | 'not_ready';
      journal: Journal;
    }
  | { status: 'failed'; reason: string; journal: Journal }
  | { status: 'busy' };

/** The request id of the void of a hold; the same for every retry and resume. */
export function voidRequestId(auctionId: string, holdId: string): string {
  return buildRequestId({ auctionId, op: 'void', holdId, amountCents: 0, generation: 0 });
}

/**
 * Voids one hold. `voided` and `released` are final. `VOID_FAILED` means the hold
 * is live and the processor refused twice; `pending` means the outcome is not
 * known yet. Never records anything in the journal.
 */
export async function voidHold(
  deps: VoidCallDeps,
  auctionId: string,
  hold: JournalHold,
): Promise<VoidStatus> {
  const requestId = voidRequestId(auctionId, hold.holdId);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
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
      auctionId,
      holdId: hold.holdId,
      op: 'void',
      requestId,
      attempt,
      outcome: error === undefined ? 'definite' : error.outcome,
      status: error === undefined ? 200 : error.status,
      ...(error?.debugId === undefined ? {} : { debugId: error.debugId }),
      label: error === undefined ? 'ok' : error.kind,
      tsMs: deps.clock.nowMs(),
    });
    if (error === undefined) return 'voided';
    if (RELEASED_KINDS.has(error.kind)) return 'released';

    let truth: HoldTruth;
    try {
      await deps.boundary?.('before:get');
      truth = await deps.gateway.getHoldTruth(truthArgs(hold));
      await deps.boundary?.('after:get');
    } catch (e) {
      if (e instanceof PayPalError) return 'pending';
      throw e;
    }
    if (GONE_TRUTH.has(truth.status)) return 'released';
    // HRD-46: a hold PayPal cannot find is not known to be released; retried on later runs.
    if (truth.status === 'NOT_FOUND') return 'pending';
    if (error.outcome === 'unknown') return 'pending';
    // A definite refusal on a live hold: one more try, then VOID_FAILED.
  }
  return 'VOID_FAILED';
}

/** R9-M04 default: a review keeps the next candidates' holds for a day. */
export const DEFAULT_REVIEW_HOLD_MAX_AGE_MS = 86_400_000;

export interface ReviewKeepOptions {
  nowMs: number;
  /** Default DEFAULT_REVIEW_HOLD_MAX_AGE_MS (24 hours). */
  reviewHoldMaxAgeMs?: number | undefined;
  /** Operator release (R9-M04): the fallback candidates' holds go at once. */
  releaseAll?: boolean | undefined;
}

/** States a review raised by the capture phase comes from: no sale is decided yet. */
const CAPTURE_PHASE: ReadonlySet<SettlementState> = new Set([
  'WINNER_SELECTED',
  'CAPTURING',
  'FALLBACK_RUNNER_UP',
]);

/**
 * The holds a settlement in FAILED_NEEDS_REVIEW keeps live. It is the one keep-set of
 * every review release: this void phase and the server's resume use it alike (R9-M04,
 * R11-O01, R11-O04).
 *
 *   - A sale keeps the winner's hold, which is captured, and nothing else.
 *   - A review raised in the capture phase, with no winner, keeps the hold of the capture
 *     in doubt (a saved capture intent) until an operator resolves the review. While the
 *     review is younger than `reviewHoldMaxAgeMs` and no operator released them, it also
 *     keeps the holds of the candidate at the cursor and of the candidates after it, so the
 *     lot can still fall back to them.
 *   - A no-sale review raised after the capture phase (in VOIDING) keeps nothing: no
 *     capture is in doubt, and the candidate at the cursor already failed.
 *
 * A candidate listed in `journal.failed` is never kept.
 */
export function reviewKeepHolds(j: Journal, o: ReviewKeepOptions): Set<string> {
  const keep = new Set<string>();
  if (j.winner !== null) {
    keep.add(j.winner.holdId);
    return keep;
  }
  const entered = [...j.history].reverse().find((h) => h.to === 'FAILED_NEEDS_REVIEW');
  if (entered === undefined || !CAPTURE_PHASE.has(entered.from)) return keep;
  if (j.intent !== null && j.intent.op === 'capture') keep.add(j.intent.holdId);
  const maxAge = o.reviewHoldMaxAgeMs ?? DEFAULT_REVIEW_HOLD_MAX_AGE_MS;
  if (o.releaseAll === true || o.nowMs - entered.tsMs > maxAge) return keep;
  for (const holdId of candidateHolds(j)) keep.add(holdId);
  return keep;
}

/**
 * The holds the capture phase can still charge: the candidate at the cursor and every
 * candidate after it, minus those listed in `journal.failed`. A failed candidate and a
 * bidder outside the plan are never charged by this settlement (the plan is fixed when the
 * settlement is created and the cursor only moves forward).
 */
function candidateHolds(j: Journal): string[] {
  const failed = new Set(j.failed.map((f) => f.bidderId));
  const out: string[] = [];
  for (const c of j.plan.candidates.slice(j.cursor)) {
    const hold = failed.has(c.bidderId) ? undefined : j.holds[c.bidderId];
    if (hold !== undefined) out.push(hold.holdId);
  }
  return out;
}

/**
 * RT4-saga-03: the holds a settlement whose capture phase is waiting keeps live. The hold of
 * any saved intent (a capture or reauthorization that may be in flight) and the holds the
 * capture phase can still charge; everything else can be released at once.
 */
function waitingKeepHolds(j: Journal): Set<string> {
  const keep = new Set<string>(candidateHolds(j));
  if (j.intent !== null) keep.add(j.intent.holdId);
  return keep;
}

export class VoidPhase {
  private readonly owner: string;

  constructor(private readonly deps: VoidDeps) {
    this.owner = deps.owner ?? defaultLeaseOwner('runner');
  }

  /** Runs, or resumes, the void phase of one settlement. */
  async run(auctionId: string): Promise<VoidOutcome> {
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

/** One run of the phase: the journal as last saved, and the steps that move it. */
class Run {
  private aborted = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly deps: VoidDeps,
    private j: Journal,
    private readonly renew: () => Promise<void>,
  ) {}

  private now(): number {
    return this.deps.clock.nowMs();
  }

  /** Journal writes happen one at a time, in the order they were asked for. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(() => fn());
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private apply(event: SettlementEvent): Promise<Journal> {
    return this.serial(async () => {
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
      await this.deps.boundary?.(`journaled:${event.type}`);
      return next;
    });
  }

  private patch(label: string, change: (draft: Journal) => void): Promise<Journal> {
    return this.serial(async () => {
      await this.renew();
      const from = this.j;
      const next = structuredClone(from);
      change(next);
      next.version = from.version + 1;
      await this.deps.journals.save(next, from.version);
      this.j = next;
      await this.deps.boundary?.(`journaled:${label}`);
      return next;
    });
  }

  private ev(type: SettlementEvent['type']): SettlementEvent {
    return { type, tsMs: this.now() } as SettlementEvent;
  }

  async drive(): Promise<VoidOutcome> {
    if (this.j.state === 'SETTLED') return { status: 'settled', journal: this.j };
    if (this.j.state === 'FAILED_NEEDS_REVIEW') {
      await this.releaseForReview();
      return this.failed(this.lastReason());
    }
    if (CAPTURE_PHASE.has(this.j.state)) {
      // RT4-saga-03: the capture phase is waiting. Holds nobody can be charged on go now;
      // the winner's and the fallback candidates' holds stay.
      await this.releaseExcept(waitingKeepHolds(this.j));
      return { status: 'pending', reason: 'not_ready', journal: this.j };
    }
    if (this.j.state === 'CAPTURED') {
      if (this.j.winner !== null) {
        const out = await this.remainder();
        if (out !== null) return out;
      }
      await this.apply(this.ev('begin_void'));
    }
    if (this.j.state !== 'VOIDING') {
      return { status: 'pending', reason: 'not_ready', journal: this.j };
    }
    return this.voiding();
  }

  /**
   * R8-P06: a settlement in review must not leave the other bidders' holds live
   * until PayPal lets them lapse. Every hold that `reviewKeepHolds` does not keep,
   * that no intent is in flight for, and that is provably not captured (its truth
   * was read) is voided. Safe to repeat: finished holds are skipped.
   */
  private async releaseForReview(): Promise<void> {
    await this.releaseExcept(
      reviewKeepHolds(this.j, {
        nowMs: this.now(),
        reviewHoldMaxAgeMs: this.deps.reviewHoldMaxAgeMs,
        releaseAll: this.deps.releaseAllReviewHolds,
      }),
    );
  }

  /**
   * Voids every hold not in `keep` that no intent is in flight for and whose truth was read
   * and is not captured. Safe to repeat: finished holds are skipped, and a hold whose read
   * fails is left for the next run.
   */
  private async releaseExcept(keep: ReadonlySet<string>): Promise<void> {
    const inFlight = this.j.intent?.holdId;
    for (const t of this.targets()) {
      if (this.aborted) return;
      if (keep.has(t.hold.holdId)) continue;
      if (DONE.has(this.statusOf(t.bidderId) ?? '')) continue;
      if (t.hold.holdId === inFlight) continue;
      let truth: HoldTruth;
      try {
        await this.deps.boundary?.('before:get');
        truth = await this.deps.gateway.getHoldTruth(truthArgs(t.hold));
        await this.deps.boundary?.('after:get');
      } catch (e) {
        if (e instanceof PayPalError) continue;
        throw e;
      }
      if (CAPTURED_TRUTH.has(truth.status)) continue;
      const status: VoidStatus = GONE_TRUTH.has(truth.status)
        ? 'released'
        : await voidHold(this.deps, this.j.auctionId, t.hold);
      // A release that keeps failing is retried on every run; the journal changes only
      // when the result does.
      if (this.statusOf(t.bidderId) === status) continue;
      await this.patch(`void_${t.bidderId}`, (d) => {
        d.voids[t.bidderId] = status;
      });
    }
  }

  private lastReason(): string {
    return this.j.history[this.j.history.length - 1]?.label.replace(/^journaled:/, '') ?? 'failed';
  }

  private failed(reason: string): VoidOutcome {
    return { status: 'failed', reason, journal: this.j };
  }

  /** R-PAY-059: the winner's remainder, once. Returns an outcome when the phase must stop. */
  private async remainder(): Promise<VoidOutcome | null> {
    const winner = this.j.winner;
    if (winner === null) return null;
    const key = remainderKey(winner.bidderId);
    if (this.j.voids[key] !== undefined) return null;
    let result: RemainderResult = await releaseWinnerRemainder(this.deps, this.j);
    // A read that lags behind the capture is read again before it is believed.
    for (let i = 1; i < MISMATCH_READS && result.status === 'mismatch'; i += 1) {
      result = await releaseWinnerRemainder(this.deps, this.j);
    }
    switch (result.status) {
      case 'unavailable': {
        // The losers do not wait for the winner's remainder.
        await this.runVoids();
        const sinceKey = `${REMAINDER_SINCE}${winner.bidderId}`;
        const since = this.sinceOf(sinceKey);
        if (since === null) {
          await this.patch('remainder_since', (d) => {
            d.voids[sinceKey] = String(this.now());
          });
        } else if (unknownExpired(since, this.now(), this.deadlineMs())) {
          // R12-P02: the winner has paid; an unreadable remainder is not a reason to end the
          // sale in review. Raise the alert and read again on the next run.
          await this.alertOnce('remainder_unconfirmed', winner.holdId);
        }
        return { status: 'pending', reason: 'remainder_unavailable', journal: this.j };
      }
      case 'mismatch': {
        await this.runVoids();
        const journal = await this.apply(this.ev('mismatch'));
        return { status: 'failed', reason: 'mismatch', journal };
      }
      case 'auto_released':
        await this.patch('remainder_closed_by_paypal', (d) => {
          d.voids[key] = 'remainder_closed_by_paypal';
        });
        return null;
      case 'remainder_voided':
        await this.patch('remainder_voided', (d) => {
          d.voids[key] = 'remainder_voided';
        });
        return null;
      case 'unreleased':
        await this.patch('remainder_unreleased', (d) => {
          d.voids[key] = 'remainder_unreleased';
        });
        return null;
    }
  }

  /** Every hold except the winner's, sorted by bidder id (R-PAY-057). */
  private targets(): Array<{ bidderId: string; hold: JournalHold }> {
    const winnerHold = this.j.winner?.holdId;
    return Object.entries(this.j.holds)
      .filter(([, h]) => h.holdId !== winnerHold)
      .map(([bidderId, hold]) => ({ bidderId, hold }))
      .sort((a, b) => (a.bidderId < b.bidderId ? -1 : a.bidderId > b.bidderId ? 1 : 0));
  }

  private deadlineMs(): number {
    return this.deps.unknownDeadlineMs ?? DEFAULT_UNKNOWN_DEADLINE_MS;
  }

  private sinceOf(key: string): number | null {
    const raw = this.j.voids[key];
    const n = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  private statusOf(bidderId: string): string | undefined {
    return this.j.voids[bidderId];
  }

  private async voiding(): Promise<VoidOutcome> {
    const max = this.deps.maxVoidResumes ?? DEFAULT_MAX_VOID_RESUMES;
    // R-PAY-058: the budget is for a definite refusal; an unknown outcome is retried free.
    const stuck = this.targets().find((t) => this.statusOf(t.bidderId) === 'VOID_FAILED');
    if (stuck !== undefined) {
      if (this.j.resumes >= max) {
        const journal = await this.apply({
          type: 'void_budget_exhausted',
          tsMs: this.now(),
          label: `journaled:void_failed:${stuck.bidderId}`,
        });
        return { status: 'failed', reason: `void_failed:${stuck.bidderId}`, journal };
      }
      await this.patch('resume', (d) => {
        d.resumes += 1;
      });
    }

    // R12-P02: the pending voids are tried again before their age is judged, so a run that
    // comes after PayPal recovered releases them instead of giving up on them.
    await this.runVoids();
    await this.markPending();

    if (this.targets().every((t) => DONE.has(this.statusOf(t.bidderId) ?? ''))) {
      const journal = await this.apply(this.ev('all_released'));
      return { status: 'settled', journal };
    }

    const expired = this.targets().filter(
      (t) =>
        this.statusOf(t.bidderId) === 'pending' &&
        unknownExpired(
          this.sinceOf(`${PENDING_SINCE}${t.bidderId}`),
          this.now(),
          this.deadlineMs(),
        ),
    );
    const [first] = expired;
    if (first !== undefined && this.j.winner === null) {
      // No sale: nothing was paid, so the review is what tells an operator.
      const journal = await this.apply({
        type: 'void_budget_exhausted',
        tsMs: this.now(),
        label: `journaled:void_unconfirmed:${first.bidderId}`,
      });
      return { status: 'failed', reason: `void_unconfirmed:${first.bidderId}`, journal };
    }
    // A sale stays VOIDING and is retried on every run until every hold is released.
    for (const t of expired) {
      await this.alertOnce(`void_unconfirmed:${t.bidderId}`, t.hold.holdId);
    }
    return { status: 'pending', reason: 'void_incomplete', journal: this.j };
  }

  /**
   * R12-P02: tells an operator once that a paid sale's release stays unconfirmed past the
   * deadline: an audit entry and a metric, then a `voids` marker so later runs stay quiet.
   * The entry is written before the marker, so a crash between them repeats it, never
   * loses it.
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

  /** Records when a hold first became pending, and forgets it once the hold moves on. */
  private async markPending(): Promise<void> {
    const now = this.now();
    const stale: string[] = [];
    const fresh: string[] = [];
    for (const t of this.targets()) {
      const key = `${PENDING_SINCE}${t.bidderId}`;
      const pending = this.statusOf(t.bidderId) === 'pending';
      if (pending && this.j.voids[key] === undefined) fresh.push(key);
      if (!pending && this.j.voids[key] !== undefined) stale.push(key);
    }
    if (fresh.length === 0 && stale.length === 0) return;
    await this.patch('pending_since', (d) => {
      for (const k of fresh) d.voids[k] = String(now);
      d.voids = Object.fromEntries(Object.entries(d.voids).filter(([k]) => !stale.includes(k)));
    });
  }

  /** Voids every target that is not done yet, with bounded concurrency. */
  private async runVoids(): Promise<void> {
    const todo = this.targets().filter((t) => !DONE.has(this.statusOf(t.bidderId) ?? ''));
    const width = Math.max(
      1,
      Math.min(this.deps.voidConcurrency ?? DEFAULT_VOID_CONCURRENCY, todo.length),
    );
    let next = 0;
    const worker = async (): Promise<void> => {
      while (!this.aborted) {
        const t = todo[next];
        next += 1;
        if (t === undefined) return;
        try {
          const status = await voidHold(this.deps, this.j.auctionId, t.hold);
          if (this.aborted) return;
          await this.patch(`void_${t.bidderId}`, (d) => {
            d.voids[t.bidderId] = status;
          });
        } catch (e) {
          this.aborted = true;
          throw e;
        }
      }
    };
    const results = await Promise.allSettled(
      Array.from({ length: todo.length === 0 ? 0 : width }, worker),
    );
    for (const r of results) if (r.status === 'rejected') throw r.reason;
  }
}

/** Runs, or resumes, the void phase of one settlement. */
export function runVoidPhase(deps: VoidDeps, auctionId: string): Promise<VoidOutcome> {
  return new VoidPhase(deps).run(auctionId);
}

export type SettlementDeps = CaptureDeps & VoidDeps;

/** The outcome of a whole run: capture, then void and release. */
export type SettlementOutcome =
  | Exclude<CaptureOutcome, { status: 'captured' | 'no_sale' }>
  | VoidOutcome;

/**
 * Runs, or resumes, a settlement from the hammer to SETTLED: the capture phase
 * (with the runner-up fallback), then the winner's remainder and the voids. A
 * capture phase that stops with `pending` or `failed` is returned as is, after the
 * holds nobody can be charged on any more are released.
 */
export async function runSettlement(
  deps: SettlementDeps,
  auctionId: string,
): Promise<SettlementOutcome> {
  const captured = await runCapturePhase(deps, auctionId);
  if (captured.status === 'failed') {
    // R8-P06: release the holds that are not in doubt before reporting the review.
    const released = await runVoidPhase(deps, auctionId);
    return released.status === 'failed' ? released : captured;
  }
  if (captured.status === 'pending') {
    // RT4-saga-03: the wait can be long; the holds no candidate can be charged on go now.
    const released = await runVoidPhase(deps, auctionId);
    return released.status === 'busy' ? captured : { ...captured, journal: released.journal };
  }
  if (captured.status !== 'captured' && captured.status !== 'no_sale') return captured;
  return runVoidPhase(deps, auctionId);
}
