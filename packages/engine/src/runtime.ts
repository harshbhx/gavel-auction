import type { Command } from './commands.js';
import { SystemClock } from './clock.js';
import type { Clock } from './clock.js';
import { EngineError } from './errors.js';
import { decide } from './decide/index.js';
import type { DecideResult } from './decide/index.js';
import { evolve } from './evolve.js';
import type { LedgerEntry } from './events.js';
import type { Hasher } from './hasher.js';
import { sealBatch } from './ledger/chain.js';
import type { LedgerStore } from './ledger/store.js';
import { replay } from './replay.js';
import { MAX_CONFLICT_RETRIES, appendRecovering } from './runtime-recovery.js';
import type { AppendOutcome } from './runtime-recovery.js';
import { decisionMetric, safeDecision } from './runtime-metrics.js';
import type { DecisionHook } from './runtime-metrics.js';
import { SubscriptionHub } from './runtime-subscribe.js';
import { pureHasher } from './sha256.js';
import { initialState } from './state.js';
import type { AuctionState } from './state.js';
import type { Ulid } from './types.js';

export type RuntimeResult = DecideResult & { entries: LedgerEntry[] };

export interface RuntimeOptions {
  store: LedgerStore;
  hasher?: Hasher;
  /** Called with the entries of a command, only after the store acknowledged them (R-ENG-100). */
  onEntries?: (auctionId: Ulid, entries: readonly LedgerEntry[]) => void;
  /** Called once per dispatched command; a failing hook never affects the result (R-ENG-105). */
  onDecision?: DecisionHook;
  /** Source of the durations reported to `onDecision`; defaults to the system clock. */
  clock?: Clock;
}

/**
 * Single-writer orchestration for the auctions a host serves. Commands of one
 * auction run strictly one after another in arrival order (R-ENG-098); state is
 * rebuilt from the store by verified replay on first use and then cached
 * (R-ENG-099); a result is returned and observers are told only once the store
 * has acknowledged the append (R-ENG-100).
 */
export class AuctionRuntime {
  private readonly store: LedgerStore;
  private readonly hasher: Hasher;
  private readonly onEntries: RuntimeOptions['onEntries'];
  private readonly onDecision: DecisionHook | undefined;
  private readonly clock: Clock;
  private readonly hub = new SubscriptionHub();
  private readonly cache = new Map<string, AuctionState>();
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(opts: RuntimeOptions) {
    this.store = opts.store;
    this.hasher = opts.hasher ?? pureHasher;
    this.onEntries = opts.onEntries;
    this.onDecision = opts.onDecision;
    this.clock = opts.clock ?? new SystemClock();
  }

  /** Every entry with seq >= fromSeq in order, then live entries, without gaps or duplicates (R-ENG-103). */
  subscribe(auctionId: Ulid, fromSeq: number): AsyncIterable<LedgerEntry> {
    return this.hub.subscribe(auctionId, fromSeq, (from) => this.store.read(auctionId, from));
  }

  /** Queues a command behind earlier ones for the same auction and resolves after the append. */
  dispatch(cmd: Command): Promise<RuntimeResult> {
    const key = cmd.auctionId;
    const tail = this.tails.get(key) ?? Promise.resolve();
    const run = (): Promise<RuntimeResult> => this.execute(cmd);
    const next = tail.then(run, run);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, settled);
    void settled.then(() => {
      if (this.tails.get(key) === settled) this.tails.delete(key);
    });
    return next;
  }

  /** Current state of an auction, after every command queued so far. */
  async state(auctionId: Ulid): Promise<AuctionState> {
    const tail = this.tails.get(auctionId) ?? Promise.resolve();
    await tail;
    return this.hydrate(auctionId);
  }

  private async hydrate(auctionId: Ulid): Promise<AuctionState> {
    const cached = this.cache.get(auctionId);
    if (cached !== undefined) return cached;
    const entries = await this.store.read(auctionId, 1);
    const state =
      entries.length === 0
        ? initialState
        : replay(entries, this.hasher, await this.headOf(auctionId));
    this.cache.set(auctionId, state);
    return state;
  }

  private async headOf(auctionId: Ulid): Promise<{ seq: number; hash: string } | undefined> {
    return (await this.store.head(auctionId)) ?? undefined;
  }

  private async execute(cmd: Command): Promise<RuntimeResult> {
    const started = this.clock.nowMs();
    const result = await this.attempt(cmd);
    const elapsed = this.clock.nowMs() - started;
    safeDecision(this.onDecision, decisionMetric(cmd, result.outcome, result.entries, elapsed));
    return result;
  }

  /**
   * Decides and appends. On a stale head the state is rebuilt from the store and the
   * command is decided again, at most MAX_CONFLICT_RETRIES times (R-ENG-101). After a
   * failure with an unknown outcome the store is checked for the command id first, so
   * an entry is never written twice (R-ENG-102).
   */
  private async attempt(cmd: Command): Promise<RuntimeResult> {
    const auctionId = cmd.auctionId;
    for (let retry = 0; ; retry++) {
      const state = await this.hydrate(auctionId);
      const result = decide(state, cmd);
      if (result.events.length === 0) return { ...result, entries: [] };
      const entries = sealBatch(
        result.events,
        { auctionId, seq: state.head.seq, hash: state.head.hash },
        cmd.at,
        cmd.commandId,
        this.hasher,
      );
      let outcome: AppendOutcome;
      try {
        outcome = await appendRecovering(
          this.store,
          auctionId,
          entries,
          state.head.seq,
          cmd.commandId,
        );
      } catch (e) {
        // The outcome of the append is unknown to this cache; rebuild from the store next time.
        this.cache.delete(auctionId);
        throw e;
      }
      if (outcome.kind === 'conflict') {
        this.cache.delete(auctionId);
        if (retry >= MAX_CONFLICT_RETRIES) {
          throw new EngineError('store_conflict', `${MAX_CONFLICT_RETRIES} retries`);
        }
        continue;
      }
      if (outcome.kind === 'stored') {
        this.cache.delete(auctionId);
        this.announce(auctionId, outcome.entries);
        return { ...result, entries: outcome.entries };
      }
      this.cache.set(auctionId, entries.reduce(evolve, state));
      this.announce(auctionId, entries);
      return { ...result, entries };
    }
  }

  private announce(auctionId: Ulid, entries: readonly LedgerEntry[]): void {
    this.hub.publish(auctionId, entries);
    this.onEntries?.(auctionId, entries);
  }
}
