import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EngineError } from '../../src/errors.js';
import type { Command } from '../../src/commands.js';
import type { LedgerEntry } from '../../src/events.js';
import { evolve } from '../../src/evolve.js';
import type { AuctionState } from '../../src/state.js';
import { SEED, runsFor } from '../property-params.js';
import { A, B, C, L1, lotConfig, mk, open, run, scene } from '../decide-helpers.js';

// TST-12 (issue 2410, gap 1): a registered bidder re-registers with a new limit (CEILING_RAISED)
// while bids and hammers interleave. Seeded like the other property files.
const params = { seed: SEED, numRuns: runsFor('limit-raise', 200) };
const OPENED_AT = 100;
const CAP = 100000;
const START = 90000;
const bidders = [A, B, C] as const;

type Op =
  | { kind: 'bid'; who: number; amount: number }
  | { kind: 'raise'; who: number; ceiling: number }
  | { kind: 'hammer' };

const who = fc.integer({ min: 0, max: 2 });
const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant('bid' as const),
    who,
    amount: fc.integer({ min: 10, max: 1100 }).map((n) => n * 100),
  }),
  fc.record({
    kind: fc.constant('raise' as const),
    who,
    // Around and above the start limit and the cap, so lowering, equal and over-cap all occur.
    ceiling: fc.integer({ min: 800, max: 1100 }).map((n) => n * 100),
  }),
  fc.constant({ kind: 'hammer' as const }),
);

describe('limit raise properties', () => {
  it('T-ENG-032 R-ENG-040 R-ENG-041 a limit never decreases, bids stay within it, the hammer price stays within the winner limit', () => {
    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 40 }), (list) => {
        const base = open(
          scene({
            lots: [lotConfig(L1, { durationMs: 1_000_000 })],
            config: { maxCeilingCents: CAP },
          }),
          L1,
          OPENED_AT,
        );
        let s: AuctionState = base;
        const log: LedgerEntry[] = [];
        let at = OPENED_AT;
        const ceilings = new Map<string, number>(bidders.map((b) => [b, START]));
        const record = (entries: readonly LedgerEntry[]): void => {
          log.push(...entries);
        };
        for (const o of list) {
          at += 10;
          const bidderId = bidders[o.kind === 'hammer' ? 0 : o.who] ?? A;
          let cmd: Command;
          if (o.kind === 'bid') {
            cmd = mk(at, {
              type: 'PlaceBid',
              lotId: L1,
              bidderId,
              amountCents: o.amount,
              source: 'manual',
              audit: {},
            });
          } else if (o.kind === 'raise') {
            cmd = mk(at, { type: 'RegisterBidder', bidderId, ceilingCents: o.ceiling });
          } else {
            cmd = mk(at, { type: 'Hammer', lotId: L1, actor: 'host', early: true });
          }
          const before = ceilings.get(bidderId) ?? START;
          try {
            const r = run(s, cmd);
            s = r.state;
            record(r.entries);
            if (o.kind === 'raise') {
              // Only a strictly higher limit within the cap is accepted.
              expect(o.ceiling).toBeGreaterThan(before);
              expect(o.ceiling).toBeLessThanOrEqual(CAP);
              expect(r.entries.map((e) => e.type)).toEqual(['CEILING_RAISED']);
              ceilings.set(bidderId, o.ceiling);
            }
            for (const e of r.entries) {
              if (e.type === 'BID_RECORDED') {
                expect(e.payload.amountCents).toBeLessThanOrEqual(
                  ceilings.get(e.payload.bidderId) ?? START,
                );
              }
              if (e.type === 'LOT_HAMMERED') {
                expect(e.payload.priceCents).toBeLessThanOrEqual(
                  ceilings.get(e.payload.winnerId) ?? START,
                );
              }
            }
          } catch (e) {
            if (!(e instanceof EngineError)) throw e;
            if (o.kind === 'raise') {
              // A refused raise is one that lowers, repeats, or passes the cap.
              expect(o.ceiling <= before || o.ceiling > CAP).toBe(true);
            }
          }
          // The stored limit always equals the highest accepted one, and never went down.
          for (const b of bidders) {
            expect(s.bidders[b]?.ceilingCents).toBe(ceilings.get(b));
          }
        }
        // Folding the ledger over the same start gives the live state: replay equals live.
        expect(log.reduce(evolve, base)).toEqual(s);
      }),
      params,
    );
  });
});
