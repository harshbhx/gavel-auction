import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.js';
import { FakeClock, FakePayPalCore } from '../src/fake/core.js';
import { FakeGateway } from '../src/fake/gateway.js';
import { PayPalGateway } from '../src/gateway.js';
import { assertSandboxConfig } from '../src/guard.js';
import { ladderStep } from '../src/ladder.js';
import { TokenManager } from '../src/oauth.js';
import type { Clock, JournalStore, PaymentsGateway } from '../src/ports.js';
import { createSettlement } from '../src/saga/create.js';
import { runSettlement, type SettlementOutcome } from '../src/saga/void.js';
import { FileJournalStore } from '../src/stores/file.js';
import { Transport } from '../src/transport.js';
import type { HoldStatus, Journal, SettlementPlan } from '../src/types.js';

/**
 * Settlement with a crash and a resume (SPEC 6.2; R-PAY-060, R-PAY-061).
 *
 * `npm run demo:settle` (fake, the default) or `npm run demo:settle -- --sandbox`.
 *
 * The run settles one lot with three bidders. The process "dies" right after the
 * capture request is answered and before the journal records it: the exact window
 * where a retry could charge twice. A new run starts from the same journal file, reads
 * PayPal's truth, adopts the capture it finds and finishes. The script prints the
 * ladder (held, charged, released) for every bidder at each stage and the number of
 * captures PayPal holds for the winner, which must be one.
 *
 * Sandbox mode needs PAYPAL_ENV=sandbox, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and
 * DEMO_AUTHS, a comma list of bidder:authorizationId:ceilingCents with already approved
 * authorizations (one per bidder, ceilings above the prices below). The sandbox guard
 * runs before any request is made.
 */

export const CRASH_LABEL = 'after:capture';

export const DEMO_CANDIDATES: ReadonlyArray<[string, number]> = [
  ['b1', 22000],
  ['b2', 21000],
  ['b3', 20000],
];

export const DEMO_RESERVE_CENTS = 5000;

export interface DemoHold {
  authId: string;
  ceilingCents: number;
}

export interface DemoEnv {
  mode: 'fake' | 'sandbox';
  gateway: PaymentsGateway;
  journals: JournalStore;
  clock: Clock;
  auctionId: string;
  holds: Record<string, DemoHold>;
  /** Called before the resume; the fake forgets its idempotency table to make the point. */
  beforeResume?: () => void;
}

export interface DemoStage {
  title: string;
  journalState: Journal['state'];
  lines: string[];
}

export interface DemoResult {
  crashes: number;
  runs: number;
  outcome: SettlementOutcome | null;
  journal: Journal;
  /** Cents captured at PayPal per bidder, read from the truth check. */
  capturedCents: Record<string, number>;
  /** Ladder labels per bidder after the final run. */
  ladder: Record<string, string>;
  stages: DemoStage[];
}

class Killed extends Error {
  constructor(readonly label: string) {
    super(`process killed at ${label}`);
    this.name = 'Killed';
  }
}

function holdStatusOf(j: Journal, bidderId: string): HoldStatus {
  const hold = j.holds[bidderId];
  if (hold === undefined) return 'UNKNOWN';
  if (j.winner?.holdId === hold.holdId) return 'CAPTURED';
  const v = j.voids[bidderId];
  if (v === 'voided' || v === 'released') return 'VOIDED';
  return 'HELD';
}

/** One line per bidder: the ladder step the buyer would see. */
export function ladderLines(j: Journal): string[] {
  return Object.keys(j.holds)
    .sort()
    .map((bidderId) => {
      const role = j.winner?.bidderId === bidderId ? 'winner' : 'other';
      const d = ladderStep(holdStatusOf(j, bidderId), j.state, role);
      return `  ${bidderId}: ${d.label}`;
    });
}

async function capturedAt(env: DemoEnv): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [bidderId, h] of Object.entries(env.holds)) {
    const t = await env.gateway.getHoldTruth({ holdId: `hold-${bidderId}`, authId: h.authId });
    out[bidderId] = t.capturedCents;
  }
  return out;
}

/** Runs the settlement, kills it at the capture boundary once, resumes it, returns what happened. */
export async function runCrashResume(
  env: DemoEnv,
  log: (line: string) => void = () => undefined,
): Promise<DemoResult> {
  const holds: SettlementPlan['holds'] = {};
  const ceilings: Record<string, number> = {};
  for (const [bidderId, h] of Object.entries(env.holds)) {
    holds[bidderId] = {
      holdId: `hold-${bidderId}`,
      authId: h.authId,
      ceilingCents: h.ceilingCents,
      createdAtMs: env.clock.nowMs(),
    };
    ceilings[bidderId] = h.ceilingCents;
  }
  await createSettlement(
    { journals: env.journals },
    {
      auctionId: env.auctionId,
      reserveCents: DEMO_RESERVE_CENTS,
      candidates: DEMO_CANDIDATES.map(([bidderId, priceCents]) => ({ bidderId, priceCents })),
      holds,
    },
  );

  const stages: DemoStage[] = [];
  const stage = async (title: string): Promise<void> => {
    const j = await env.journals.load(env.auctionId);
    if (j === null) throw new Error('settlement journal is missing');
    const s = { title, journalState: j.state, lines: ladderLines(j) };
    stages.push(s);
    log(`[${j.state}] ${title}`);
    for (const l of s.lines) log(l);
  };

  let killed = false;
  const boundary = (label: string): void => {
    if (!killed && label === CRASH_LABEL) {
      killed = true;
      throw new Killed(label);
    }
  };

  log(`mode: ${env.mode}; lot ${env.auctionId}; ${DEMO_CANDIDATES.length} bidders`);
  await stage('holds in place, settlement created');

  let outcome: SettlementOutcome | null = null;
  let crashes = 0;
  let runs = 0;
  while (runs < 5) {
    runs += 1;
    try {
      outcome = await runSettlement(
        {
          journals: env.journals,
          gateway: env.gateway,
          audit: { append: async () => undefined },
          clock: env.clock,
          boundary,
        },
        env.auctionId,
      );
      if (outcome.status === 'settled' || outcome.status === 'failed') break;
    } catch (e) {
      if (!(e instanceof Killed)) throw e;
      crashes += 1;
      await stage(`run ${runs} killed at ${e.label}: PayPal charged, the journal does not know`);
      env.beforeResume?.();
      log('restarting from the journal file');
    }
  }
  await stage(`run ${runs} finished`);

  const journal = await env.journals.load(env.auctionId);
  if (journal === null) throw new Error('settlement journal is missing');
  const capturedCents = await capturedAt(env);
  const ladder: Record<string, string> = {};
  for (const bidderId of Object.keys(ceilings)) {
    const role = journal.winner?.bidderId === bidderId ? 'winner' : 'other';
    ladder[bidderId] = ladderStep(holdStatusOf(journal, bidderId), journal.state, role).label;
  }
  const winner = journal.winner;
  const captures = Object.values(capturedCents).filter((c) => c > 0).length;
  log(
    `result: ${journal.state}; winner ${winner?.bidderId ?? 'none'} charged ${winner?.amountCents ?? 0} cents; ` +
      `${captures} capture(s) at PayPal`,
  );
  return { crashes, runs, outcome, journal, capturedCents, ladder, stages };
}

const AUCTION_ID = 'demo-lot-1';

/** A fresh fake PayPal with one authorization per demo bidder and a file journal in a temp dir. */
export function fakeDemoEnv(dir: string = mkdtempSync(join(tmpdir(), 'gavel-demo-'))): DemoEnv {
  const clock = new FakeClock(1_800_000_000_000);
  const core = new FakePayPalCore({ clock });
  const holds: Record<string, DemoHold> = {};
  const ceilings: Record<string, number> = { b1: 30000, b2: 25000, b3: 25000 };
  for (const [bidderId, ceilingCents] of Object.entries(ceilings)) {
    holds[bidderId] = {
      authId: core.createAuthorization(`payer-${bidderId}`, ceilingCents).id,
      ceilingCents,
    };
  }
  return {
    mode: 'fake',
    gateway: new FakeGateway(core),
    journals: new FileJournalStore(join(dir, 'journals.json')),
    clock: { nowMs: () => clock.nowMs() },
    auctionId: AUCTION_ID,
    holds,
    beforeResume: () => core.forgetIdempotency(),
  };
}

/** Parses DEMO_AUTHS: "b1:AUTHID:30000,b2:AUTHID:25000". */
export function parseDemoAuths(raw: string): Record<string, DemoHold> {
  const out: Record<string, DemoHold> = {};
  for (const part of raw.split(',')) {
    const [bidderId, authId, cents] = part.trim().split(':');
    const ceilingCents = Number(cents);
    if (!bidderId || !authId || !Number.isInteger(ceilingCents) || ceilingCents <= 0) {
      throw new Error('DEMO_AUTHS must look like bidder:authorizationId:ceilingCents,...');
    }
    out[bidderId] = { authId, ceilingCents };
  }
  for (const [bidderId] of DEMO_CANDIDATES) {
    if (out[bidderId] === undefined) throw new Error(`DEMO_AUTHS has no entry for ${bidderId}`);
  }
  return out;
}

/** Sandbox environment from process variables; the sandbox guard runs first. */
export function sandboxDemoEnv(
  vars: Record<string, string | undefined>,
  dir: string = mkdtempSync(join(tmpdir(), 'gavel-demo-')),
): DemoEnv {
  const config = loadConfig({ ...vars, GAVEL_PAYMENTS_FAKE: '' });
  const base = assertSandboxConfig(config);
  const auth = new TokenManager({
    transport: new Transport(),
    baseUrl: base.origin,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
  return {
    mode: 'sandbox',
    gateway: new PayPalGateway({ auth, fake: false }),
    journals: new FileJournalStore(join(dir, 'journals.json')),
    clock: { nowMs: () => Date.now() },
    auctionId: `demo-${Date.now()}`,
    holds: parseDemoAuths(vars['DEMO_AUTHS'] ?? ''),
  };
}
