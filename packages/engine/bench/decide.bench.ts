import { bench, describe } from 'vitest';
import type { Command } from '../src/commands.js';
import { decide } from '../src/decide/index.js';
import { evolve } from '../src/evolve.js';
import { sealBatch } from '../src/ledger/chain.js';
import { replay } from '../src/replay.js';
import { pureHasher } from '../src/sha256.js';
import { initialState } from '../src/state.js';
import type { AuctionState } from '../src/state.js';
import type { LedgerEntry } from '../src/events.js';
import { AU, L1, id, lotConfig, mk } from '../test/decide-helpers.js';

// Run with `npx vitest bench -w @gavel/engine`; the budgets are asserted by test/perf.test.ts.
const BIDDERS = 200;
const BIDS = 5000;

let state: AuctionState = initialState;
const entries: LedgerEntry[] = [];
const dispatch = (cmd: Command): void => {
  const r = decide(state, cmd);
  const sealed = sealBatch(
    r.events,
    { auctionId: AU, seq: state.head.seq, hash: state.head.hash },
    cmd.at,
    cmd.commandId,
    pureHasher,
  );
  state = sealed.reduce(evolve, state);
  entries.push(...sealed);
};
const who = (i: number) => id(`B${(i + 1).toString(16).toUpperCase()}`);
const bidCommand = (k: number): Command =>
  mk(10 + k, {
    type: 'PlaceBid',
    lotId: L1,
    bidderId: who(k % BIDDERS),
    amountCents: 1000 + 100 * k,
    source: 'manual',
    audit: {},
  });

dispatch(
  mk(0, { type: 'CreateAuction', title: 'Bench', config: { maxCeilingCents: 100_000_000 } }),
);
dispatch(mk(0, { type: 'AddLot', lot: lotConfig(L1, { durationMs: 86_400_000 }) }));
for (let i = 0; i < BIDDERS; i += 1) {
  dispatch(mk(0, { type: 'RegisterBidder', bidderId: who(i), ceilingCents: 100_000_000 }));
}
dispatch(mk(1, { type: 'OpenLot', lotId: L1 }));
for (let k = 0; k < BIDS; k += 1) dispatch(bidCommand(k));
const sealedLedger = entries.slice();

describe('engine decision path', () => {
  const next = bidCommand(BIDS);
  bench('decide one PlaceBid at 200 bidders and 5000 bids', () => {
    decide(state, next);
  });
  bench('verified replay of the recorded ledger', () => {
    replay(sealedLedger, pureHasher);
  });
});
