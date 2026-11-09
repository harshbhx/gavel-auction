import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EngineError } from '../../src/errors.js';
import type { Command } from '../../src/commands.js';
import type { LedgerEntry } from '../../src/events.js';
import type { AuctionState } from '../../src/state.js';
import { nextDeadline } from '../../src/decide/index.js';
import { SEED, runsFor } from '../property-params.js';
import { A, B, C, L1, lotConfig, mk, open, run, scene } from '../decide-helpers.js';

// TST-12 (issue 2410, gap 2): PauseLot / ResumeLot / ExtendLot interleaved with bids, ticks and
// hammers, soft close on. Small run count so the file stays fast; seeded like the other files.
const params = { seed: SEED, numRuns: runsFor('clock-controls', 200) };
const OPENED_AT = 100;
const bidders = [A, B, C] as const;

type Op =
  | { kind: 'pause' | 'resume' | 'tick' | 'hammer' | 'bid'; gap: number }
  | { kind: 'extend'; gap: number; extra: number };

const gap = fc.integer({ min: 0, max: 4000 });
const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constantFrom('pause', 'resume', 'tick', 'hammer', 'bid'), gap }),
  fc.record({
    kind: fc.constant('extend' as const),
    gap,
    extra: fc.integer({ min: 1, max: 20000 }),
  }),
) as fc.Arbitrary<Op>;
const ops = fc.array(op, { minLength: 1, maxLength: 40 });
const softClose = fc.record({
  windowMs: fc.integer({ min: 0, max: 5000 }),
  extensionMs: fc.integer({ min: 0, max: 5000 }),
  maxExtensions: fc.integer({ min: 0, max: 4 }),
});

const typesOf = (entries: readonly LedgerEntry[]): string[] => entries.map((e) => e.type);

describe('clock control properties', () => {
  it('T-ENG-039 R-RT-048 R-RT-049 pause, resume, extend: no negative remaining time, no bid while paused, one hammer at most', () => {
    fc.assert(
      fc.property(softClose, ops, (sc, list) => {
        let s: AuctionState = open(
          scene({ lots: [lotConfig(L1, { durationMs: 8000, softClose: sc })] }),
          L1,
          OPENED_AT,
        );
        let at = OPENED_AT;
        let price = 1000;
        let hammers = 0;
        list.forEach((o, i) => {
          at += o.gap;
          const lotBefore = s.lots[L1];
          const pausedBefore = lotBefore?.pausedRemainingMs !== undefined;
          let cmd: Command;
          switch (o.kind) {
            case 'pause':
              cmd = mk(at, { type: 'PauseLot', lotId: L1, actor: 'host' });
              break;
            case 'resume':
              cmd = mk(at, { type: 'ResumeLot', lotId: L1, actor: 'host' });
              break;
            case 'extend':
              cmd = mk(at, {
                type: 'ExtendLot',
                lotId: L1,
                extraMs: o.extra,
                reason: 'prop',
                actor: 'host',
              });
              break;
            case 'tick':
              cmd = mk(at, { type: 'Tick' });
              break;
            case 'hammer':
              cmd = mk(at, { type: 'Hammer', lotId: L1, actor: 'host', early: true });
              break;
            case 'bid':
              price += 100;
              cmd = mk(at, {
                type: 'PlaceBid',
                lotId: L1,
                bidderId: bidders[i % 3] ?? A,
                amountCents: price,
                source: 'manual',
                audit: {},
              });
              break;
          }
          let entries: readonly LedgerEntry[] = [];
          try {
            const r = run(s, cmd);
            s = r.state;
            entries = r.entries;
          } catch (e) {
            // The engine refuses a command that does not fit the state in its own terms; any
            // other error (an invariant failure, a crash) fails the property.
            if (!(e instanceof EngineError)) throw e;
          }
          const types = typesOf(entries);
          // Never accept a bid while paused.
          if (pausedBefore) expect(types).not.toContain('BID_RECORDED');
          hammers += types.filter((t) => t === 'LOT_HAMMERED').length;
          for (const e of entries) {
            if (e.type === 'LOT_PAUSED') {
              expect(e.payload.remainingMs).toBeGreaterThanOrEqual(0);
            }
            if (e.type === 'LOT_RESUMED' || e.type === 'LOT_EXTENDED') {
              expect(e.payload.endsAtAfter).toBeGreaterThanOrEqual(e.payload.endsAtBefore);
            }
            if (e.type === 'LOT_RESUMED') {
              expect(e.payload.endsAtAfter).toBeGreaterThanOrEqual(at);
            }
          }
          const lot = s.lots[L1];
          if (lot?.pausedRemainingMs !== undefined) {
            expect(lot.pausedRemainingMs).toBeGreaterThanOrEqual(0);
            expect(nextDeadline(s)).toBeNull();
          }
        });
        expect(hammers).toBeLessThanOrEqual(1);
      }),
      params,
    );
  });
});
