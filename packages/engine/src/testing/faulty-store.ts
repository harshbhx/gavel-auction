import type { LedgerEntry } from '../events.js';
import { LedgerConflict } from '../ledger/store.js';
import type { LedgerStore } from '../ledger/store.js';
import type { Ulid } from '../types.js';

/**
 * What goes wrong with one `append` call (R-ENG-076, R-ENG-100):
 * - `fail_before`: the call is rejected and nothing reaches the inner store.
 * - `fail_after`: the whole batch is stored, then the call is rejected, as when the
 *   acknowledgement is lost on the way back.
 * - `torn`: a writer that died part-way hands the inner store a batch with a hole in it. An
 *   atomic store refuses such a batch whole, so nothing is kept and the call is rejected.
 * - `delay`: the call waits `ms` before it is passed on.
 * - `conflict`: the call is rejected with a stale-head conflict and nothing is stored.
 * - `reorder_ack`: the batch is stored at once but the acknowledgement arrives `ms` later, so
 *   acknowledgements of concurrent appends can overtake each other.
 */
export type Fault =
  | { kind: 'fail_before' }
  | { kind: 'fail_after' }
  | { kind: 'torn' }
  | { kind: 'delay'; ms: number }
  | { kind: 'conflict' }
  | { kind: 'reorder_ack'; ms: number };

/** What the plan is told about an `append` call. */
export interface AppendCall {
  /** Zero based number of this call over the whole life of the store, retries included. */
  call: number;
  auctionId: Ulid;
  entries: readonly LedgerEntry[];
  expectedHeadSeq: number;
}

/** A fault per call number (null or past the end means none), or a function that decides. */
export type FaultPlan = readonly (Fault | null)[] | ((call: AppendCall) => Fault | null);

/** The error every injected failure is rejected with. */
export class InjectedFault extends Error {
  readonly fault: Fault['kind'];
  constructor(fault: Fault['kind']) {
    super(`injected fault: ${fault}`);
    this.name = 'InjectedFault';
    this.fault = fault;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Wraps any LedgerStore and makes `append` fail, stall or lie on a plan. Reads are never faulted. */
export class FaultyStore implements LedgerStore {
  /** Every append call seen, in order, with the fault applied to it ('none' when there was none). */
  readonly calls: Array<{ call: AppendCall; fault: Fault['kind'] | 'none' }> = [];
  private readonly persisted = new Map<string, number>();

  constructor(
    private readonly inner: LedgerStore,
    private readonly plan: FaultPlan = [],
  ) {}

  /** Highest seq of an auction that the inner store has stored, whether or not it was acknowledged. */
  persistedSeq(auctionId: Ulid): number {
    return this.persisted.get(auctionId) ?? 0;
  }

  async append(
    auctionId: Ulid,
    entries: readonly LedgerEntry[],
    expectedHeadSeq: number,
  ): Promise<void> {
    const call: AppendCall = { call: this.calls.length, auctionId, entries, expectedHeadSeq };
    const fault =
      typeof this.plan === 'function' ? this.plan(call) : (this.plan[call.call] ?? null);
    this.calls.push({ call, fault: fault?.kind ?? 'none' });
    if (fault === null) {
      await this.write(auctionId, entries, expectedHeadSeq);
      return;
    }
    switch (fault.kind) {
      case 'fail_before':
        throw new InjectedFault('fail_before');
      case 'conflict':
        throw new LedgerConflict(expectedHeadSeq, expectedHeadSeq + 1);
      case 'fail_after':
        await this.write(auctionId, entries, expectedHeadSeq);
        throw new InjectedFault('fail_after');
      case 'torn':
        try {
          await this.inner.append(auctionId, torn(entries), expectedHeadSeq);
        } catch {
          // An atomic store refuses the broken batch whole.
        }
        throw new InjectedFault('torn');
      case 'delay':
        await sleep(fault.ms);
        await this.write(auctionId, entries, expectedHeadSeq);
        return;
      case 'reorder_ack':
        await this.write(auctionId, entries, expectedHeadSeq);
        await sleep(fault.ms);
        return;
    }
  }

  read(auctionId: Ulid, fromSeq: number): Promise<LedgerEntry[]> {
    return this.inner.read(auctionId, fromSeq);
  }

  head(auctionId: Ulid): Promise<{ seq: number; hash: string } | null> {
    return this.inner.head(auctionId);
  }

  private async write(
    auctionId: Ulid,
    entries: readonly LedgerEntry[],
    expectedHeadSeq: number,
  ): Promise<void> {
    await this.inner.append(auctionId, entries, expectedHeadSeq);
    const last = entries.at(-1);
    if (last !== undefined) this.persisted.set(auctionId, last.seq);
  }
}

/** A batch as a crashed writer leaves it: the last entry is out of sequence, so there is a hole. */
function torn(entries: readonly LedgerEntry[]): LedgerEntry[] {
  return entries.map((e, i) =>
    i === entries.length - 1 ? ({ ...e, seq: e.seq + 1 } as LedgerEntry) : e,
  );
}
