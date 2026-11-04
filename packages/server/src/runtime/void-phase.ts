import {
  PayPalError,
  buildRequestId,
  step,
  withLease,
  type AuditSink,
  type Clock,
  type HoldStore,
  type HoldTruth,
  type Journal,
  type JournalStore,
  type PaymentsGateway,
  type SettlementEvent,
} from '@gavel/payments';

/**
 * Release phase of a settlement: after the winner is captured (or nobody can be
 * charged) every other authorization is voided, then the journal moves to SETTLED.
 * Each void carries a request id derived from the hold, so a retry or a resume
 * repeats the same call and PayPal applies it once. A void that finds the
 * authorization already voided, expired or gone counts as released.
 */

export interface VoidPhaseDeps {
  journals: JournalStore;
  gateway: PaymentsGateway;
  holds: HoldStore;
  audit: AuditSink;
  clock: Clock;
  /** Lease owner. Default "runner". */
  owner?: string;
  /** Void attempts per hold in one run before the phase reports `pending`. Default 3. */
  maxAttempts?: number;
  /** Called at every crash boundary; a throw simulates a crash at that point. */
  boundary?: (label: string) => Promise<void> | void;
}

export type VoidOutcome =
  | { status: 'settled'; journal: Journal }
  /** Some voids are not confirmed yet; a later run repeats them. */
  | { status: 'pending'; journal: Journal }
  /** The journal is not in a state this phase handles (not captured yet, or failed). */
  | { status: 'not_ready'; journal: Journal }
  /** The winner's authorization does not match the capture; the journal needs review. */
  | { status: 'failed'; journal: Journal }
  | { status: 'busy' };

const RELEASED_KINDS: ReadonlySet<string> = new Set(['already_voided', 'expired', 'not_found']);

/** True when this bidder's hold has a recorded release, under the bidder key or the old hold key. */
export function isReleased(journal: Journal, bidderId: string, holdId: string): boolean {
  return journal.voids[bidderId] !== undefined || journal.voids[holdId] !== undefined;
}

/** Kinds that mean the void will never work, however often it is repeated. */
const REFUSED_KINDS: ReadonlySet<string> = new Set([
  'auth_failed',
  'invalid_request',
  'already_captured',
  'rejected',
]);

export function voidRequestId(journal: Journal, holdId: string): string {
  return buildRequestId({
    auctionId: journal.auctionId,
    op: 'void',
    holdId,
    amountCents: 0,
    generation: 0,
  });
}

/** Holds to release: every hold in the journal except the winner's. */
export function voidTargets(
  journal: Journal,
): Array<{ bidderId: string; holdId: string; authId: string }> {
  const winnerHold = journal.winner?.holdId;
  return Object.entries(journal.holds)
    .filter(([, h]) => h.holdId !== winnerHold)
    .map(([bidderId, h]) => ({ bidderId, holdId: h.holdId, authId: h.authId }))
    .sort((a, b) => (a.holdId < b.holdId ? -1 : a.holdId > b.holdId ? 1 : 0));
}

export async function runVoidPhase(deps: VoidPhaseDeps, auctionId: string): Promise<VoidOutcome> {
  const owner = deps.owner ?? 'runner';
  const leased = await withLease(
    { journals: deps.journals, clock: deps.clock },
    auctionId,
    owner,
    async (renew) => {
      const first = await deps.journals.load(auctionId);
      if (first === null) throw new Error(`no settlement for auction ${auctionId}`);
      return new VoidRun(deps, first, renew).drive();
    },
  );
  return leased.status === 'busy' ? { status: 'busy' } : leased.value;
}

class VoidRun {
  constructor(
    private readonly deps: VoidPhaseDeps,
    private j: Journal,
    private readonly renew: () => Promise<void>,
  ) {}

  private async boundary(label: string): Promise<void> {
    await this.deps.boundary?.(label);
  }

  private async save(next: Journal, label: string): Promise<void> {
    await this.renew();
    await this.deps.journals.save(next, this.j.version);
    const from = this.j;
    this.j = next;
    if (from.state !== next.state) {
      await this.deps.audit.append({
        kind: 'state_change',
        auctionId: next.auctionId,
        from: from.state,
        to: next.state,
        label,
        tsMs: this.deps.clock.nowMs(),
      });
    }
    await this.boundary(label);
  }

  private async apply(event: SettlementEvent): Promise<void> {
    await this.save(step(this.j, event).journal, `journaled:${event.type}`);
  }

  async drive(): Promise<VoidOutcome> {
    if (this.j.state === 'SETTLED') return { status: 'settled', journal: this.j };
    if (this.j.state === 'CAPTURED') {
      const stopped = await this.remainder();
      if (stopped !== null) return stopped;
      await this.apply({ type: 'begin_void', tsMs: this.deps.clock.nowMs() });
    }
    if (this.j.state !== 'VOIDING') return { status: 'not_ready', journal: this.j };

    // Records are keyed by bidder id, as reconcile, the kill switch and the ladder read them.
    for (const target of voidTargets(this.j)) {
      if (isReleased(this.j, target.bidderId, target.holdId)) continue;
      const how = await this.release(target);
      if (how === 'refused') return this.escalate();
      if (how === null) continue;
      const next = structuredClone(this.j);
      next.voids[target.bidderId] = how;
      next.version = this.j.version + 1;
      await this.save(next, 'journaled:void');
    }
    // Also covers a crash between a journaled void and the hold record update.
    for (const target of voidTargets(this.j)) {
      if (isReleased(this.j, target.bidderId, target.holdId)) await this.markHold(target.holdId);
    }

    const open = voidTargets(this.j).filter((t) => !isReleased(this.j, t.bidderId, t.holdId));
    if (open.length > 0) return { status: 'pending', journal: this.j };
    await this.apply({ type: 'all_released', tsMs: this.deps.clock.nowMs() });
    return { status: 'settled', journal: this.j };
  }

  /**
   * The winner's unused authorization (R-PAY-059): whether PayPal frees it after the final
   * capture is not verified, so it is read back and voided when still open. Done once.
   */
  private async remainder(): Promise<VoidOutcome | null> {
    const winner = this.j.winner;
    if (winner === null) return null;
    const key = `remainder:${winner.bidderId}`;
    if (this.j.voids[key] !== undefined) return null;
    const hold = this.j.holds[winner.bidderId];
    if (hold === undefined) return this.mismatch();
    let truth: HoldTruth;
    try {
      await this.boundary('before:get');
      truth = await this.deps.gateway.getHoldTruth({ holdId: hold.holdId, authId: hold.authId });
    } catch (e) {
      if (e instanceof PayPalError) return { status: 'pending', journal: this.j };
      throw e;
    }
    if (truth.status !== 'CAPTURED' || truth.capturedCents !== winner.amountCents) {
      return this.mismatch();
    }
    const remainder = hold.ceilingCents - winner.amountCents;
    let label = 'remainder_released';
    if (truth.amountCents > truth.capturedCents && remainder > 0) {
      const requestId = buildRequestId({
        auctionId: this.j.auctionId,
        op: 'void',
        holdId: hold.holdId,
        amountCents: remainder,
        generation: 0,
      });
      try {
        await this.boundary('before:remainder-void');
        await this.deps.gateway.voidAuthorization(hold.authId, requestId);
        label = 'remainder_voided';
      } catch (e) {
        if (!(e instanceof PayPalError)) throw e;
        if (e.kind === 'already_captured' || RELEASED_KINDS.has(e.kind))
          label = 'remainder_released';
        else if (e.outcome === 'unknown') return { status: 'pending', journal: this.j };
        else label = 'remainder_unreleased'; // left to expire; the settlement still completes
      }
    }
    const next = structuredClone(this.j);
    next.voids[key] = label;
    next.version = this.j.version + 1;
    await this.save(next, `journaled:${label}`);
    return null;
  }

  /** A void PayPal refuses for good cannot be retried away: hand the settlement to an operator. */
  private async escalate(): Promise<VoidOutcome> {
    await this.apply({ type: 'void_budget_exhausted', tsMs: this.deps.clock.nowMs() });
    return { status: 'failed', journal: this.j };
  }

  private async mismatch(): Promise<VoidOutcome> {
    await this.apply({ type: 'mismatch', tsMs: this.deps.clock.nowMs() });
    return { status: 'failed', journal: this.j };
  }

  /** One authorization released: how it was recorded, or null when still unconfirmed. */
  private async release(target: {
    holdId: string;
    authId: string;
  }): Promise<'voided' | 'released' | 'refused' | null> {
    const attempts = this.deps.maxAttempts ?? 3;
    const requestId = voidRequestId(this.j, target.holdId);
    for (let i = 0; i < attempts; i++) {
      await this.renew();
      await this.boundary('before:void');
      try {
        await this.deps.gateway.voidAuthorization(target.authId, requestId);
        await this.boundary('after:void');
        return 'voided';
      } catch (e) {
        if (!(e instanceof PayPalError)) throw e;
        if (RELEASED_KINDS.has(e.kind)) return 'released';
        if (e.outcome === 'definite' && REFUSED_KINDS.has(e.kind)) return 'refused';
      }
    }
    return null;
  }

  private async markHold(holdId: string): Promise<void> {
    const hold = await this.deps.holds.get(holdId);
    if (hold === null || hold.status === 'VOIDED' || hold.status === 'CAPTURED') return;
    await this.deps.holds.put({ ...hold, status: 'VOIDED' });
  }
}

export interface SpareVoidDeps {
  gateway: PaymentsGateway;
  holds: HoldStore;
}

/**
 * Voids every live hold of the auction that the settlement does not keep: a second hold a
 * bidder approved after registering, a hold of a bidder who never registered, or, when the
 * settlement ends in review, every hold but the one with an unresolved capture. The request
 * id comes from the hold, so a repeat is applied once by PayPal. Returns how many voids are
 * still unconfirmed; a later run repeats them.
 */
export async function voidSpareHolds(
  deps: SpareVoidDeps,
  journal: Journal,
  keep: ReadonlySet<string>,
): Promise<number> {
  let open = 0;
  for (const hold of await deps.holds.listByAuction(journal.auctionId)) {
    if (hold.status !== 'HELD' || hold.authId === undefined || keep.has(hold.holdId)) continue;
    try {
      await deps.gateway.voidAuthorization(hold.authId, voidRequestId(journal, hold.holdId));
    } catch (e) {
      if (!(e instanceof PayPalError)) throw e;
      if (!RELEASED_KINDS.has(e.kind)) {
        open += 1;
        continue;
      }
    }
    await deps.holds.put({ ...hold, status: 'VOIDED' });
  }
  return open;
}
