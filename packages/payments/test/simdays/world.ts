import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_HOLD_MAX_AGE_MS } from '../../src/config.js';
import { DAY_MS, FakeClock, FakePayPalCore, type FakeCoreOptions } from '../../src/fake/core.js';
import { FakeGateway } from '../../src/fake/gateway.js';
import { createSettlement, DEFAULT_LEASE_TTL_MS } from '../../src/saga/create.js';
import {
  DEFAULT_HONOR_SAFE_MS,
  persistReauthorization,
  reauthorizeIfDue,
  type ReauthPolicy,
} from '../../src/saga/reauth.js';
import { runSettlement, type SettlementDeps } from '../../src/saga/void.js';
import { FileJournalStore } from '../../src/stores/file.js';
import { MemoryHoldStore, MemoryJournalStore } from '../../src/stores/memory.js';
import type { Journal, PaymentAudit, SettlementPlan } from '../../src/types.js';

/**
 * Simulated-clock world for multi-day tests of OUR code (saga, reauthorization, stores,
 * webhook merge) against the fake PayPal's model of authorization time (see
 * src/fake/ASSUMPTIONS.md, rows A07 to A11). Nothing here sleeps or reads the wall clock:
 * "days" are advances of an injected FakeClock, so a month runs in seconds.
 */

export { DAY_MS };

/** Fixed start of simulated time, so every run produces the same report. */
export const START_MS = Date.UTC(2026, 10, 1, 0, 0, 0);
export const HOUR_MS = 3_600_000;
export const MIN_MS = 60_000;

/** The PayPal model used by every scenario unless it says otherwise. */
export interface TimeModel {
  honorMs: number;
  validityMs: number;
  /** "fail": a capture after the honor period is refused. The strict reading of PayPal's rule. */
  afterHonorCapture: 'ok' | 'fail';
}

export const STRICT_MODEL: TimeModel = {
  honorMs: 3 * DAY_MS,
  validityMs: 29 * DAY_MS,
  afterHonorCapture: 'fail',
};

export interface WorldOptions {
  model?: TimeModel;
  /** The server's GAVEL_REAUTH flag. Default on. */
  reauth?: boolean;
  /** Keep the journals in a file, so a restart reads them back from disk. */
  fileBacked?: boolean;
  core?: FakeCoreOptions;
}

export interface HoldRef {
  holdId: string;
  authId: string;
  bidderId: string;
  ceilingCents: number;
  createdAtMs: number;
  orderId: string;
}

/** A simulated process crash thrown from a boundary hook. */
export class SimCrash extends Error {
  constructor(readonly label: string) {
    super(`simulated crash at ${label}`);
    this.name = 'SimCrash';
  }
}

export interface SettleOptions {
  /** Probability that any single boundary crashes the process. */
  crashProb?: number;
  rand?: () => number;
  /** Labels that crash the process once each, at their first occurrence. */
  crashOnce?: readonly string[];
  /** Simulated time the process stays down after a crash. */
  downMs?: (rand: () => number) => number;
  /** The fake forgets its idempotency table at every restart. */
  forgetIdempotency?: boolean;
  maxPasses?: number;
}

export interface SettleResult {
  status: 'settled' | 'failed' | 'stuck';
  passes: number;
  crashes: number;
  /** Total simulated time the process was down. */
  downMs: number;
  journal: Journal | null;
}

const REAUTH_STATES: ReadonlySet<string> = new Set([
  'HELD',
  'BIDDING',
  'WINNER_SELECTED',
  'CAPTURING',
  'FALLBACK_RUNNER_UP',
]);

export class World {
  readonly clock = new FakeClock(START_MS);
  readonly core: FakePayPalCore;
  readonly gw: FakeGateway;
  readonly audits: PaymentAudit[] = [];
  readonly holds = new MemoryHoldStore();
  readonly policy: ReauthPolicy;
  readonly model: TimeModel;
  journals: MemoryJournalStore;
  /** Every hold ever opened, with its first authorization id. */
  readonly roots: HoldRef[] = [];
  private readonly dir: string | null;
  private seq = 0;

  constructor(opts: WorldOptions = {}) {
    this.model = opts.model ?? STRICT_MODEL;
    this.core = new FakePayPalCore({
      clock: this.clock,
      honorMs: this.model.honorMs,
      validityMs: this.model.validityMs,
      afterHonorCapture: this.model.afterHonorCapture,
      ...opts.core,
    });
    this.gw = new FakeGateway(this.core);
    this.policy = { enabled: opts.reauth ?? true, honorSafeMs: DEFAULT_HONOR_SAFE_MS };
    this.dir = opts.fileBacked === true ? mkdtempSync(join(tmpdir(), 'gavel-sim-')) : null;
    this.journals = this.openJournals();
  }

  private openJournals(): MemoryJournalStore {
    return this.dir === null
      ? new MemoryJournalStore()
      : new FileJournalStore(join(this.dir, 'journals.json'));
  }

  /** A process restart: file-backed journals are read back from disk, leases are gone. */
  restartProcess(): void {
    if (this.dir !== null) this.journals = this.openJournals();
  }

  /** Moves simulated time to this many days after the start (never backwards). */
  atDay(days: number): void {
    const t = START_MS + Math.round(days * DAY_MS);
    if (t > this.clock.nowMs()) this.clock.set(t);
  }

  /** Simulated days since the start, to two decimals. */
  day(): number {
    return Math.round(((this.clock.nowMs() - START_MS) / DAY_MS) * 100) / 100;
  }

  /** A buyer approves a hold now: an authorization at the fake and a HELD hold record. */
  async openHold(auctionId: string, bidderId: string, ceilingCents: number): Promise<HoldRef> {
    this.seq += 1;
    const holdId = `hold-${auctionId}-${bidderId}`;
    const created = this.core.createAuthorization(`payer-${bidderId}`, ceilingCents);
    const ref: HoldRef = {
      holdId,
      authId: created.id,
      bidderId,
      ceilingCents,
      createdAtMs: this.clock.nowMs(),
      orderId: `order-${this.seq}`,
    };
    this.roots.push(ref);
    await this.holds.put({
      holdId,
      auctionId,
      bidderId,
      orderId: ref.orderId,
      authId: ref.authId,
      ceilingCents,
      status: 'HELD',
      createdAtMs: ref.createdAtMs,
    });
    return ref;
  }

  planFor(
    auctionId: string,
    holds: readonly HoldRef[],
    candidates: ReadonlyArray<[string, number]>,
    reserveCents = 5000,
  ): SettlementPlan {
    const byBidder: SettlementPlan['holds'] = {};
    for (const h of holds) {
      byBidder[h.bidderId] = {
        holdId: h.holdId,
        authId: h.authId,
        ceilingCents: h.ceilingCents,
        createdAtMs: h.createdAtMs,
        orderId: h.orderId,
      };
    }
    return {
      auctionId,
      reserveCents,
      candidates: candidates.map(([bidderId, priceCents]) => ({ bidderId, priceCents })),
      holds: byBidder,
    };
  }

  /** The hammer: creates the settlement at the current time, with the production hold-age limit. */
  async close(plan: SettlementPlan): Promise<void> {
    await createSettlement(
      {
        journals: this.journals,
        clock: { nowMs: () => this.clock.nowMs() },
        holdMaxAgeMs: DEFAULT_HOLD_MAX_AGE_MS,
        audit: { append: async (e) => void this.audits.push(e) },
      },
      plan,
    );
  }

  deps(boundary?: (label: string) => void): SettlementDeps {
    return {
      journals: this.journals,
      gateway: this.gw,
      audit: { append: async (e) => void this.audits.push(e) },
      clock: { nowMs: () => this.clock.nowMs() },
      ...(boundary === undefined ? {} : { boundary }),
    };
  }

  reauthCalls(): number {
    return this.core.calls.filter((c) => c.op === 'reauthorize').length;
  }

  /**
   * The reauthorization pass the server runs before every capture pass (it mirrors
   * AuctionService.reauthorizeDue): candidates from the cursor on, once per hold, only while no
   * capture has succeeded. Returns true while a reauthorization is unsettled and the capture
   * must wait.
   */
  async reauthPass(auctionId: string, boundary?: (label: string) => void): Promise<boolean> {
    if (!this.policy.enabled) return false;
    const journal = await this.journals.load(auctionId);
    if (journal === null || !REAUTH_STATES.has(journal.state)) return false;
    const failed = new Set(journal.failed.map((f) => f.bidderId));
    const inDoubt = journal.intent?.op === 'capture' ? journal.intent.holdId : undefined;
    const clock = { nowMs: () => this.clock.nowMs() };
    const audit = { append: async (e: PaymentAudit) => void this.audits.push(e) };
    let blocked = false;
    for (const cand of journal.plan.candidates.slice(journal.cursor)) {
      const hold = journal.holds[cand.bidderId];
      if (hold === undefined || failed.has(cand.bidderId) || hold.holdId === inDoubt) continue;
      if ((hold.priorAuthIds?.length ?? 0) > 0) continue;
      const out = await reauthorizeIfDue(
        { gateway: this.gw, audit, clock, ...(boundary === undefined ? {} : { boundary }) },
        auctionId,
        {
          holdId: hold.holdId,
          authId: hold.authId,
          ceilingCents: hold.ceilingCents,
          startedAtMs: hold.createdAtMs ?? this.clock.nowMs(),
          generation: hold.priorAuthIds?.length ?? 0,
        },
        this.policy,
      );
      if (out.status === 'unknown') {
        blocked = true;
        continue;
      }
      if (out.status !== 'reauthorized') continue;
      const saved = await persistReauthorization(
        { journals: this.journals, holds: this.holds, clock },
        auctionId,
        hold.holdId,
        out,
      );
      if (saved === 'busy') blocked = true;
    }
    return blocked;
  }

  /**
   * Runs one settlement like the server loop: reauthorization pass, then the saga, again after
   * every crash (the process stays down for a simulated time first) until it is terminal.
   */
  async settle(auctionId: string, o: SettleOptions = {}): Promise<SettleResult> {
    const rand = o.rand ?? (() => 0.5);
    const once = new Set(o.crashOnce ?? []);
    const maxPasses = o.maxPasses ?? 60;
    const boundary = (label: string): void => {
      if (once.delete(label)) throw new SimCrash(label);
      if (o.crashProb !== undefined && rand() < o.crashProb) throw new SimCrash(label);
    };
    let passes = 0;
    let crashes = 0;
    let downMs = 0;
    let status: SettleResult['status'] = 'stuck';
    while (passes < maxPasses) {
      passes += 1;
      try {
        const blocked = await this.reauthPass(auctionId, boundary);
        if (blocked) {
          this.clock.advance(5 * MIN_MS);
          continue;
        }
        const out = await runSettlement(this.deps(boundary), auctionId);
        if (out.status === 'settled' || out.status === 'failed') {
          status = out.status;
          break;
        }
        this.clock.advance(5 * MIN_MS);
      } catch (e) {
        if (!(e instanceof SimCrash)) throw e;
        crashes += 1;
        const down = o.downMs?.(rand) ?? DEFAULT_LEASE_TTL_MS + HOUR_MS;
        const waited = Math.max(down, DEFAULT_LEASE_TTL_MS + MIN_MS);
        downMs += waited;
        this.clock.advance(waited);
        this.restartProcess();
        if (o.forgetIdempotency === true) this.core.forgetIdempotency();
      }
    }
    return { status, passes, crashes, downMs, journal: await this.journals.load(auctionId) };
  }

  /** The chain of authorizations of one hold, first to last. */
  chainOf(h: HoldRef): string[] {
    return this.core.reauthorizationChain(h.authId);
  }

  /** What happened to the money of one hold, from the fake's own records. */
  moneyOf(h: HoldRef): { capturedCents: number; releasedCents: number; openCents: number } {
    const chain = this.chainOf(h);
    const last = chain[chain.length - 1] ?? h.authId;
    const capturedCents = this.core
      .orderCaptures(h.authId)
      .filter((c) => c.status !== 'DECLINED')
      .reduce((sum, c) => sum + c.amountCents, 0);
    const releasedCents = this.core.released(last);
    return {
      capturedCents,
      releasedCents,
      openCents: h.ceilingCents - capturedCents - releasedCents,
    };
  }

  holdsOf(auctionId: string): HoldRef[] {
    return this.roots.filter((r) => r.holdId.startsWith(`hold-${auctionId}-`));
  }
}

export interface LedgerSummary {
  holds: number;
  heldCents: number;
  capturedCents: number;
  releasedCents: number;
  openCents: number;
  winnersCents: number;
  /** Every violated rule, in plain words. Empty when the books are clean. */
  problems: string[];
}

/**
 * The invariants of the brief, checked from the fake's records and the journals:
 * no double capture, no lost hold, and the ledger balances to the cent
 * (held = captured + released + still open, captured = what the journals say was won).
 */
export async function auditWorld(
  w: World,
  auctionIds: readonly string[],
  opts: { allowOpen?: boolean } = {},
): Promise<LedgerSummary> {
  const problems: string[] = [];
  try {
    w.core.checkInvariants();
  } catch (e) {
    problems.push(`fake invariant: ${e instanceof Error ? e.message : String(e)}`);
  }
  let heldCents = 0;
  let capturedCents = 0;
  let releasedCents = 0;
  let openCents = 0;
  for (const h of w.roots) {
    const live = w.core.orderCaptures(h.authId).filter((c) => c.status !== 'DECLINED');
    if (live.length > 1) problems.push(`${h.holdId}: ${live.length} captures on one hold`);
    const m = w.moneyOf(h);
    if (m.openCents < 0) problems.push(`${h.holdId}: captured plus released exceeds the hold`);
    if (m.openCents > 0 && opts.allowOpen !== true) {
      problems.push(`${h.holdId}: ${m.openCents} cents still held, never released`);
    }
    heldCents += h.ceilingCents;
    capturedCents += m.capturedCents;
    releasedCents += m.releasedCents;
    openCents += m.openCents;
  }
  if (heldCents !== capturedCents + releasedCents + openCents) {
    problems.push('held does not equal captured plus released plus open');
  }
  let winnersCents = 0;
  for (const auctionId of auctionIds) {
    const j = await w.journals.load(auctionId);
    if (j === null) {
      problems.push(`${auctionId}: no journal`);
      continue;
    }
    const roots = w.holdsOf(auctionId);
    const charged = roots.filter((h) => w.moneyOf(h).capturedCents > 0);
    if (charged.length > 1) problems.push(`${auctionId}: ${charged.length} buyers were charged`);
    if (j.winner !== null) {
      winnersCents += j.winner.amountCents;
      const root = roots.find((h) => h.holdId === j.winner?.holdId);
      const got = root === undefined ? -1 : w.moneyOf(root).capturedCents;
      if (got !== j.winner.amountCents) {
        problems.push(`${auctionId}: journal says ${j.winner.amountCents}, PayPal captured ${got}`);
      }
      const planned = j.plan.candidates.find((c) => c.bidderId === j.winner?.bidderId);
      if (planned?.priceCents !== j.winner.amountCents) {
        problems.push(`${auctionId}: winner charged a price other than the planned one`);
      }
    } else if (j.state === 'SETTLED' && charged.length > 0) {
      problems.push(`${auctionId}: settled without a winner but a buyer was charged`);
    }
  }
  if (winnersCents !== capturedCents) {
    problems.push(`captured ${capturedCents} cents but the journals won ${winnersCents}`);
  }
  return {
    holds: w.roots.length,
    heldCents,
    capturedCents,
    releasedCents,
    openCents,
    winnersCents,
    problems,
  };
}
