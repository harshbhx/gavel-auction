import { verifyChain } from '@gavel/engine';
import { CONFIG, ledgerKey, makeRig } from '../../test/flow/rig';
import { setUp, type Check, type LoadDeps } from './run';
import { tally } from './clients';

// L3 hammer race (R-QA-030, T-QA-062): many short auctions, each with every bidder sending the same
// amount at the same moment. In every iteration exactly one bid may win, every bid is answered once
// and the ledger chain of the auction must verify. Runs in process on the fake PayPal.
// Run it with src/load/cli.ts.

export const HAMMER_ITERATIONS = 500;
export const HAMMER_BIDDERS = 6;

export interface HammerReport {
  scenario: 'L3';
  iterations: number;
  bidders: number;
  /** Iterations that broke at least one invariant. */
  violations: number;
  checks: Check[];
  ok: boolean;
}

export interface HammerDeps extends LoadDeps {
  iterations?: number;
}

export async function runL3(deps: HammerDeps): Promise<HammerReport> {
  const iterations = deps.iterations ?? HAMMER_ITERATIONS;
  const bidders = deps.bidders ?? HAMMER_BIDDERS;
  const rig = await makeRig();
  let wrongWinners = 0;
  let lost = 0;
  let duplicate = 0;
  let badChain = 0;
  try {
    for (let i = 0; i < iterations; i += 1) {
      const field = await setUp({ ...deps, bidders }, rig);
      const amount = CONFIG.reserve + ((i % 20) + 1) * CONFIG.minIncrement;
      await Promise.all(field.bidders.map((b) => b.bid(amount)));
      const t = tally(field.bidders);
      if (t.accepted !== 1 || t.rejected !== bidders - 1) wrongWinners += 1;
      lost += t.lost;
      duplicate += t.duplicate;
      const entries = await rig.stores.ledger.read(ledgerKey(field.room.auctionId), 1);
      if (entries.length > 0 && !verifyChain(entries).ok) badChain += 1;
    }
  } finally {
    await rig.paypal.stop();
  }
  const checks: Check[] = [
    { name: 'one winner per race', ok: wrongWinners === 0, detail: `${String(wrongWinners)} bad` },
    { name: 'no lost bid', ok: lost === 0, detail: `${String(lost)} lost` },
    { name: 'no duplicate reply', ok: duplicate === 0, detail: `${String(duplicate)} duplicate` },
    { name: 'ledger chain verifies', ok: badChain === 0, detail: `${String(badChain)} broken` },
  ];
  return {
    scenario: 'L3',
    iterations,
    bidders,
    violations: wrongWinners + lost + duplicate + badChain,
    checks,
    ok: checks.every((c) => c.ok),
  };
}
