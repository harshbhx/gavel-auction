import type { FakeFaultKind, FakeOp } from '../../src/fake/core.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { runSettlement, type SettlementOutcome } from '../../src/saga/void.js';
import { canonicalJson, type Journal } from '../../src/types.js';
import { CEILINGS, makeRig, seed, type Rig } from '../saga/rig.js';

/**
 * Crash-point harness (SPEC 6.2; R-PAY-042, R-PAY-060).
 *
 * The saga reports a label at every crash boundary: `journaled:<event>` after a
 * save, `before:`/`after:` around each call to `get`, `capture` and `void`. The
 * harness counts those labels across the whole life of a settlement (every run and
 * every resume), and throws a crash when the count reaches a chosen index.
 *
 *   1. `enumerate` does a dry run and returns the labels in order.
 *   2. `drive` runs a settlement on a fresh fake, crashing at the given indexes. After
 *      a crash a new runner starts from the same journal store, optionally after the
 *      fake forgot its idempotency table, until the settlement is terminal.
 *   3. `assertEquivalent` compares that outcome with the uninterrupted run.
 *
 * Equivalence compares the canonical journal and the effects on the fake. The
 * canonical journal ignores `resumes`, timestamps and the version (a count of saves,
 * which includes resume patches), and treats two spellings of the same result as
 * one: a capture adopted from the truth check is a capture (`adopted` and
 * `capture_ok`), and a hold that is voided or already released is released.
 */

export class Crash extends Error {
  constructor(
    readonly index: number,
    readonly label: string,
  ) {
    super(`crash at boundary ${index} (${label})`);
    this.name = 'Crash';
  }
}

export const AUCTION_ID = 'auc1';

/** More resumes than any single-fault settlement needs. */
export const MAX_RUNS = 12;

export interface Scenario {
  ceilings: Record<string, number>;
  candidates: Array<[string, number]>;
  /** Arms faults on the fresh fake before the first run. */
  arm?: (rig: Rig) => void;
}

/** Three bidders; the first candidate wins. */
export const THREE_BIDDERS: Scenario = {
  ceilings: CEILINGS,
  candidates: [
    ['b1', 22000],
    ['b2', 21000],
    ['b3', 20000],
  ],
};

/** The first candidate is declined, so the runner-up wins. */
export const DECLINED_FIRST: Scenario = {
  ...THREE_BIDDERS,
  arm: (rig) => rig.core.inject('capture', 'capture_declined', rig.auth['b1'] ?? '', 1),
};

/** The answer to the first capture is lost although PayPal applied it. */
export const LOST_FIRST_CAPTURE: Scenario = {
  ...THREE_BIDDERS,
  arm: (rig) => rig.core.inject('capture', 'timeout_after_success', null, 1),
};

export interface DriveOptions {
  /** Boundary indexes at which the runner crashes (counted across all runs). */
  crashAt?: readonly number[];
  /** The fake forgets its idempotency table before every resume. */
  forgetIdempotency?: boolean;
  /** Receives every label in order. */
  labels?: string[];
  maxRuns?: number;
}

export interface DriveResult {
  rig: Rig;
  journal: Journal;
  outcome: SettlementOutcome | null;
  /** Runs that started, the first one included. */
  runs: number;
  crashes: number;
}

export async function freshRig(s: Scenario): Promise<Rig> {
  const rig = makeRig(s.ceilings);
  await seed(rig, s.candidates, s.ceilings);
  s.arm?.(rig);
  return rig;
}

/** Runs the settlement to a terminal state, crashing and resuming as asked. */
export async function drive(s: Scenario, opts: DriveOptions = {}): Promise<DriveResult> {
  const rig = await freshRig(s);
  const crashAt = new Set(opts.crashAt ?? []);
  const maxRuns = opts.maxRuns ?? MAX_RUNS;
  let n = 0;
  const boundary = (label: string): void => {
    const index = n;
    n += 1;
    opts.labels?.push(label);
    if (crashAt.has(index)) throw new Crash(index, label);
  };
  const deps = { ...rig.deps, boundary };

  let outcome: SettlementOutcome | null = null;
  let runs = 0;
  let crashes = 0;
  while (runs < maxRuns) {
    runs += 1;
    try {
      outcome = await runSettlement(deps, AUCTION_ID);
      if (outcome.status === 'settled' || outcome.status === 'failed') break;
    } catch (e) {
      if (!(e instanceof Crash)) throw e;
      crashes += 1;
      if (opts.forgetIdempotency === true) rig.core.forgetIdempotency();
    }
  }
  const journal = await rig.journals.load(AUCTION_ID);
  if (journal === null) throw new Error('settlement missing');
  return { rig, journal, outcome, runs, crashes };
}

/** The labels an uninterrupted run passes, in order (the dry run). */
export async function enumerate(s: Scenario): Promise<string[]> {
  const labels: string[] = [];
  await drive(s, { labels });
  return labels;
}

/** The journal without what may differ between equal runs (see the file comment). */
export function canonicalJournal(j: Journal): string {
  const c = structuredClone(j);
  c.resumes = 0;
  c.version = 0;
  c.unknownSince = null;
  c.history = c.history.map((h) => ({
    ...h,
    tsMs: 0,
    label: h.label === 'journaled:adopted' ? 'journaled:capture_ok' : h.label,
  }));
  if (c.intent !== null) c.intent.startedAtMs = 0;
  for (const [k, v] of Object.entries(c.voids)) if (v === 'voided') c.voids[k] = 'released';
  return canonicalJson(c);
}

/** Effects on the fake, per bidder: what was captured and how many voids took effect. */
export function effectsOf(
  rig: Rig,
): Record<string, { capturedCents: number; voidEffects: number }> {
  const out: Record<string, { capturedCents: number; voidEffects: number }> = {};
  for (const [bidder, authId] of Object.entries(rig.auth)) {
    const i = rig.core.inspect(authId);
    out[bidder] = { capturedCents: i.capturedCents, voidEffects: i.voidEffects };
  }
  return out;
}

/**
 * Crashes at the given indexes and checks the result against the uninterrupted
 * run: same canonical journal, same effects on the fake, invariants hold.
 */
export async function assertEquivalent(
  s: Scenario,
  crashAt: readonly number[],
  opts: Pick<DriveOptions, 'forgetIdempotency'> = {},
  baseline?: DriveResult,
): Promise<DriveResult> {
  const base = baseline ?? (await drive(s));
  const run = await drive(s, { ...opts, crashAt });
  const where = `crash at ${crashAt.join(',')}${opts.forgetIdempotency === true ? ' + forget_idempotency' : ''}`;
  if (run.crashes === 0) {
    throw new Error(`${where}: no crash happened`);
  }
  if (run.journal.state !== 'SETTLED') throw new Error(`${where}: ended in ${run.journal.state}`);
  const a = canonicalJournal(base.journal);
  const b = canonicalJournal(run.journal);
  if (a !== b) throw new Error(`${where}: journal differs\nexpected ${a}\nreceived ${b}`);
  const ea = canonicalJson(effectsOf(base.rig));
  const eb = canonicalJson(effectsOf(run.rig));
  if (ea !== eb) throw new Error(`${where}: effects differ\nexpected ${ea}\nreceived ${eb}`);
  assertFakeInvariants(run.rig.core);
  assertFakeInvariants(base.rig.core);
  return run;
}

// ---------- seeded randomness (R-PAY-150)

/** mulberry32: small seeded PRNG, the same on every platform. */
export function prng(seedValue: number): () => number {
  let a = seedValue >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Faults a single call can suffer, by operation (SPEC 4.5). */
const FAULTS: Record<'capture' | 'void' | 'get', readonly FakeFaultKind[]> = {
  capture: [
    'timeout_before',
    'timeout_after_success',
    'http_500',
    'http_429',
    'connection_reset',
    'forget_idempotency',
    'capture_declined',
  ],
  void: [
    'timeout_before',
    'timeout_after_success',
    'http_500',
    'http_429',
    'connection_reset',
    'forget_idempotency',
  ],
  get: ['timeout_before', 'http_500', 'http_429', 'connection_reset'],
};

export interface RandomCase {
  seed: number;
  scenario: Scenario;
  fault: { op: FakeOp; kind: FakeFaultKind; target: string | null };
}

/** A random plan of 2 to 8 bidders and one random fault, fully determined by the seed. */
export function randomCase(seedValue: number): RandomCase {
  const rand = prng(seedValue);
  const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)] as T;

  const count = int(2, 8);
  const bidders = Array.from({ length: count }, (_, i) => `b${i + 1}`);
  const ceilings: Record<string, number> = {};
  for (const b of bidders) ceilings[b] = int(20, 100) * 500;
  const reserve = 5000;

  const order = [...bidders];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = int(0, i);
    [order[i], order[j]] = [order[j] as string, order[i] as string];
  }
  const candidates: Array<[string, number]> = [];
  let previous = Number.POSITIVE_INFINITY;
  for (const b of order) {
    const hi = Math.min(previous, ceilings[b] ?? 0);
    if (hi < reserve) continue;
    const price = reserve + int(0, Math.floor((hi - reserve) / 100)) * 100;
    candidates.push([b, price]);
    previous = price;
  }

  const op = pick(['capture', 'void', 'get'] as const);
  const kind = pick(FAULTS[op]);
  const targetIsAny = rand() < 0.3;
  const target = targetIsAny ? null : pick(bidders);
  const scenario: Scenario = {
    ceilings,
    candidates,
    arm: (rig) => rig.core.inject(op, kind, target === null ? null : (rig.auth[target] ?? null), 1),
  };
  return { seed: seedValue, scenario, fault: { op, kind, target } };
}
