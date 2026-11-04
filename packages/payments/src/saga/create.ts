import type { AuditSink, Clock, JournalStore } from '../ports.js';
import { JournalExists } from '../stores/memory.js';
import { DEFAULT_MAX_ATTEMPTS, DEFAULT_TIMEOUT_MS, RETRY_AFTER_MAX_MS } from '../transport.js';
import { canonicalJson } from '../types.js';
import type { Journal, JournalHold, SettlementPlan } from '../types.js';

/**
 * Settlement creation, plan validation and the run lease
 * (SPEC 3.4, R-PAY-044, R-PAY-045).
 *
 * `createSettlement` is idempotent on auctionId: the same plan returns the stored
 * journal, a different plan is `plan_mismatch`. A plan that cannot be settled
 * (the same bidder twice, a candidate without a hold, bad amounts) is
 * `plan_invalid` and nothing is stored. The lease is held in the journal store
 * with an expiry (default 30 s) and renewed per step; a second runner while the
 * lease is live gets `busy`. Version compare-and-set on the journal keeps a
 * runner whose lease expired from overwriting the new owner's work.
 */

export type SettlementErrorCode = 'plan_mismatch' | 'plan_invalid';

export class SettlementError extends Error {
  code: SettlementErrorCode;
  constructor(code: SettlementErrorCode, message: string) {
    super(message);
    this.name = 'SettlementError';
    this.code = code;
  }
}

/** The lease was taken over while this runner was working. */
export class LeaseLost extends Error {
  constructor(auctionId: string, owner: string) {
    super(`lease for ${auctionId} is no longer held by ${owner}`);
    this.name = 'LeaseLost';
  }
}

/**
 * One retried money call can take attempts * timeout plus the Retry-After sleeps
 * (130 s with the transport defaults) and a 401 doubles that. The lease must
 * outlive that, or a second runner can start while the first call is in flight.
 */
export const DEFAULT_LEASE_TTL_MS =
  2 *
    (DEFAULT_MAX_ATTEMPTS * DEFAULT_TIMEOUT_MS + (DEFAULT_MAX_ATTEMPTS - 1) * RETRY_AFTER_MAX_MS) +
  60_000;

function isCents(n: unknown, min: number): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= min;
}

/** Throws SettlementError("plan_invalid") for a plan that cannot be settled. */
export function validatePlan(plan: SettlementPlan): void {
  const bad = (why: string): never => {
    throw new SettlementError('plan_invalid', why);
  };
  if (typeof plan.auctionId !== 'string' || plan.auctionId === '') bad('auctionId is required');
  if (!isCents(plan.reserveCents, 0)) bad('reserveCents must be a non-negative integer');

  if (!Array.isArray(plan.candidates)) bad('candidates must be a list');
  if (plan.holds === null || typeof plan.holds !== 'object' || Array.isArray(plan.holds)) {
    bad('holds must be an object keyed by bidder');
  }

  const seen = new Set<string>();
  let previousPrice = Number.POSITIVE_INFINITY;
  for (const c of plan.candidates) {
    if (typeof c.bidderId !== 'string' || c.bidderId === '') bad('candidate bidderId is required');
    if (seen.has(c.bidderId)) bad(`bidder ${c.bidderId} appears more than once`);
    seen.add(c.bidderId);
    if (!isCents(c.priceCents, 1)) bad(`price of ${c.bidderId} must be a positive integer`);
    const hold = plan.holds[c.bidderId];
    if (hold === undefined) bad(`bidder ${c.bidderId} has no hold`);
    // Never plan a charge the buyer did not authorize or the seller would not accept (R-PAY-061, R-PAY-062).
    if (hold !== undefined && c.priceCents > hold.ceilingCents) {
      bad(`price of ${c.bidderId} is above its hold ceiling`);
    }
    if (c.priceCents < plan.reserveCents) bad(`price of ${c.bidderId} is below the reserve`);
    // A fallback is priced as if the earlier candidates were out, so it never rises.
    if (c.priceCents > previousPrice) bad(`price of ${c.bidderId} is above an earlier candidate`);
    previousPrice = c.priceCents;
  }

  const holdIds = new Set<string>();
  for (const [bidderId, h] of Object.entries(plan.holds)) {
    if (typeof h.holdId !== 'string' || h.holdId === '') bad(`hold of ${bidderId} has no holdId`);
    if (typeof h.authId !== 'string' || h.authId === '') bad(`hold of ${bidderId} has no authId`);
    if (!isCents(h.ceilingCents, 1)) bad(`ceiling of ${bidderId} must be a positive integer`);
    if (!isCents(h.createdAtMs, 0)) bad(`createdAtMs of ${bidderId} must be a safe integer`);
    if (holdIds.has(h.holdId)) bad(`hold ${h.holdId} is used by more than one bidder`);
    holdIds.add(h.holdId);
  }
}

/** What newJournal needs to flag stale holds: the injected clock reading and GAVEL_HOLD_MAX_AGE_MS. */
export interface HoldAgePolicy {
  nowMs: number;
  holdMaxAgeMs: number;
}

/** The first journal of a settlement: state HELD, version 0, nothing done yet. */
export function newJournal(plan: SettlementPlan, age: HoldAgePolicy): Journal {
  const holds: Record<string, JournalHold> = {};
  for (const [bidderId, h] of Object.entries(plan.holds)) {
    holds[bidderId] = {
      holdId: h.holdId,
      authId: h.authId,
      ceilingCents: h.ceilingCents,
      createdAtMs: h.createdAtMs,
      // A hold older than the maximum age at settlement start is flagged (R-PAY-034).
      stale: age.nowMs - h.createdAtMs > age.holdMaxAgeMs,
    };
  }
  return {
    v: 1,
    auctionId: plan.auctionId,
    version: 0,
    state: 'HELD',
    plan: {
      reserveCents: plan.reserveCents,
      candidates: plan.candidates.map((c) => ({ bidderId: c.bidderId, priceCents: c.priceCents })),
    },
    holds,
    cursor: 0,
    intent: null,
    unknownSince: null,
    winner: null,
    failed: [],
    voids: {},
    resumes: 0,
    history: [],
  };
}

/** What identifies a plan for the idempotency check. */
function planKey(j: Pick<Journal, 'plan' | 'holds'>): string {
  const holds: Record<string, unknown> = {};
  for (const [bidderId, h] of Object.entries(j.holds)) {
    holds[bidderId] = { holdId: h.holdId, authId: h.authId, ceilingCents: h.ceilingCents };
  }
  return canonicalJson({ plan: j.plan, holds });
}

export interface CreateResult {
  journal: Journal;
  /** False when the settlement already existed with an equal plan. */
  created: boolean;
}

/**
 * Creates the settlement for the plan's auction once. A repeat call with an equal
 * plan returns the stored journal; a different plan throws plan_mismatch.
 */
export async function createSettlement(
  deps: { journals: JournalStore; clock: Clock; holdMaxAgeMs: number; audit: AuditSink },
  plan: SettlementPlan,
): Promise<CreateResult> {
  validatePlan(plan);
  if (!Number.isSafeInteger(deps.holdMaxAgeMs) || deps.holdMaxAgeMs <= 0) {
    throw new SettlementError('plan_invalid', 'holdMaxAgeMs must be a positive integer');
  }
  const nowMs = deps.clock.nowMs();
  const fresh = newJournal(plan, { nowMs, holdMaxAgeMs: deps.holdMaxAgeMs });

  const compare = (existing: Journal): CreateResult => {
    if (planKey(existing) !== planKey(fresh)) {
      throw new SettlementError(
        'plan_mismatch',
        `settlement for ${plan.auctionId} exists with a different plan`,
      );
    }
    return { journal: existing, created: false };
  };

  const existing = await deps.journals.load(plan.auctionId);
  if (existing !== null) return compare(existing);
  try {
    await deps.journals.create(fresh);
    // One audit row per stale hold, written once with the journal that carries the flag. A stale
    // hold is still captured (R-PAY-072); the flag and the row are what an operator reads.
    for (const [bidderId, h] of Object.entries(fresh.holds)) {
      if (h.stale !== true) continue;
      await deps.audit.append({
        kind: 'stale_hold',
        auctionId: plan.auctionId,
        holdId: h.holdId,
        label: `age_ms=${nowMs - (h.createdAtMs ?? nowMs)} bidder=${bidderId}`,
        tsMs: nowMs,
      });
    }
    return { journal: fresh, created: true };
  } catch (e) {
    if (!(e instanceof JournalExists)) throw e;
    // Lost a race with another creator: judge against what it stored.
    const winner = await deps.journals.load(plan.auctionId);
    if (winner === null) throw e;
    return compare(winner);
  }
}

export interface LeaseDeps {
  journals: JournalStore;
  clock: Clock;
}

/** Extends the lease. Throws LeaseLost when another runner holds it now. */
export async function renewLease(
  deps: LeaseDeps,
  auctionId: string,
  owner: string,
  ttlMs: number = DEFAULT_LEASE_TTL_MS,
): Promise<void> {
  const ok = await deps.journals.acquireLease(auctionId, owner, ttlMs, deps.clock.nowMs());
  if (!ok) throw new LeaseLost(auctionId, owner);
}

export type LeaseRun<T> = { status: 'busy' } | { status: 'done'; value: T };

/**
 * Runs `fn` while holding the auction's lease. Returns `busy` without running
 * `fn` when another owner holds a live lease. `fn` receives a `renew` function
 * to call before each step. The lease is released afterwards, also on failure;
 * a lease already taken over by someone else is left alone by the store.
 */
export async function withLease<T>(
  deps: LeaseDeps,
  auctionId: string,
  owner: string,
  fn: (renew: () => Promise<void>) => Promise<T>,
  ttlMs: number = DEFAULT_LEASE_TTL_MS,
): Promise<LeaseRun<T>> {
  const granted = await deps.journals.acquireLease(auctionId, owner, ttlMs, deps.clock.nowMs());
  if (!granted) return { status: 'busy' };
  try {
    const value = await fn(() => renewLease(deps, auctionId, owner, ttlMs));
    return { status: 'done', value };
  } finally {
    await deps.journals.releaseLease(auctionId, owner);
  }
}
