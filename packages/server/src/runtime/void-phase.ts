import {
  PayPalError,
  buildRequestId,
  step,
  withLease,
  type AuditSink,
  type Clock,
  type HoldStore,
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
  | { status: 'busy' };

const RELEASED_KINDS: ReadonlySet<string> = new Set(['already_voided', 'expired', 'not_found']);

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
      await this.apply({ type: 'begin_void', tsMs: this.deps.clock.nowMs() });
    }
    if (this.j.state !== 'VOIDING') return { status: 'not_ready', journal: this.j };

    for (const target of voidTargets(this.j)) {
      if (this.j.voids[target.holdId] !== undefined) continue;
      if (!(await this.release(target))) continue;
      const next = structuredClone(this.j);
      next.voids[target.holdId] = voidRequestId(this.j, target.holdId);
      next.version = this.j.version + 1;
      await this.save(next, 'journaled:void');
    }
    // Also covers a crash between a journaled void and the hold record update.
    for (const target of voidTargets(this.j)) {
      if (this.j.voids[target.holdId] !== undefined) await this.markHold(target.holdId);
    }

    const open = voidTargets(this.j).filter((t) => this.j.voids[t.holdId] === undefined);
    if (open.length > 0) return { status: 'pending', journal: this.j };
    await this.apply({ type: 'all_released', tsMs: this.deps.clock.nowMs() });
    return { status: 'settled', journal: this.j };
  }

  /** One authorization released, or false when it is still unconfirmed after the attempts. */
  private async release(target: { holdId: string; authId: string }): Promise<boolean> {
    const attempts = this.deps.maxAttempts ?? 3;
    const requestId = voidRequestId(this.j, target.holdId);
    for (let i = 0; i < attempts; i++) {
      await this.renew();
      await this.boundary('before:void');
      try {
        await this.deps.gateway.voidAuthorization(target.authId, requestId);
        await this.boundary('after:void');
        return true;
      } catch (e) {
        if (!(e instanceof PayPalError)) throw e;
        if (RELEASED_KINDS.has(e.kind)) return true;
      }
    }
    return false;
  }

  private async markHold(holdId: string): Promise<void> {
    const hold = await this.deps.holds.get(holdId);
    if (hold === null || hold.status === 'VOIDED' || hold.status === 'CAPTURED') return;
    await this.deps.holds.put({ ...hold, status: 'VOIDED' });
  }
}
