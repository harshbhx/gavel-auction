import { PayPalError } from '../errors.js';
import type { AuditSink, Clock, JournalStore, PaymentsGateway } from '../ports.js';
import type { PaymentsMetrics } from '../ports.js';
import { buildRequestId } from '../requestId.js';
import type { HoldTruth, Journal, JournalHold } from '../types.js';
import { runCapturePhase, type CaptureDeps, type CaptureOutcome } from './capture.js';
import { defaultLeaseOwner } from './owner.js';
import { withLease } from './create.js';
import { step, type SettlementEvent } from './machine.js';
import { releaseWinnerRemainder, remainderKey, type RemainderResult } from './remainder.js';

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
 * `pending` hold is retried on every run and does not use the budget. Voids are not
 * blocked by the kill switch (R-PAY-006, R-PAY-063).
 *
 * The journal keeps one entry per bidder in `voids`: voided, released,
 * VOID_FAILED or pending. The winner's remainder is kept under `remainder:<id>`.
 */

export const DEFAULT_VOID_CONCURRENCY = 3;
export const DEFAULT_MAX_VOID_RESUMES = 5;
/** Reads of the winner's authorization before a mismatch is believed. */
const MISMATCH_READS = 3;

export type VoidStatus = 'voided' | 'released' | 'VOID_FAILED' | 'pending';

const DONE: ReadonlySet<string> = new Set<VoidStatus>(['voided', 'released']);
const RELEASED_KINDS: ReadonlySet<string> = new Set(['already_voided', 'expired']);
const GONE_TRUTH: ReadonlySet<HoldTruth['status']> = new Set(['VOIDED', 'EXPIRED', 'NOT_FOUND']);

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
  /** Lease owner. Default: a random id fixed for this process. */
  owner?: string;
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
      truth = await deps.gateway.getHoldTruth({ holdId: hold.holdId, authId: hold.authId });
      await deps.boundary?.('after:get');
    } catch (e) {
      if (e instanceof PayPalError) return 'pending';
      throw e;
    }
    if (GONE_TRUTH.has(truth.status)) return 'released';
    if (error.outcome === 'unknown') return 'pending';
    // A definite refusal on a live hold: one more try, then VOID_FAILED.
  }
  return 'VOID_FAILED';
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
      this.owner,
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
    if (this.j.state === 'FAILED_NEEDS_REVIEW') return this.failed(this.lastReason());
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
      case 'unavailable':
        // The losers do not wait for the winner's remainder.
        await this.runVoids();
        return { status: 'pending', reason: 'remainder_unavailable', journal: this.j };
      case 'mismatch': {
        await this.runVoids();
        const journal = await this.apply(this.ev('mismatch'));
        return { status: 'failed', reason: 'mismatch', journal };
      }
      case 'auto_released':
        await this.patch('remainder_released', (d) => {
          d.voids[key] = 'remainder_released';
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

    await this.runVoids();

    if (this.targets().every((t) => DONE.has(this.statusOf(t.bidderId) ?? ''))) {
      const journal = await this.apply(this.ev('all_released'));
      return { status: 'settled', journal };
    }
    return { status: 'pending', reason: 'void_incomplete', journal: this.j };
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
 * capture phase that stops with `pending` or `failed` is returned as is.
 */
export async function runSettlement(
  deps: SettlementDeps,
  auctionId: string,
): Promise<SettlementOutcome> {
  const captured = await runCapturePhase(deps, auctionId);
  if (captured.status !== 'captured' && captured.status !== 'no_sale') return captured;
  return runVoidPhase(deps, auctionId);
}
