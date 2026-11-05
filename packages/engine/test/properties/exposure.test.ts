import fc from 'fast-check';
import { SEED as PROPERTY_SEED, runsFor } from '../property-params.js';
import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/commands.js';
import { EngineError, InvariantError } from '../../src/errors.js';
import { available, bidderFor, committed, scopeKey } from '../../src/rules/exposure.js';
import { initialState } from '../../src/state.js';
import type { AuctionState } from '../../src/state.js';
import type { LotConfig, Mode, Ulid } from '../../src/types.js';
import { A, B, C, L1, L2, captured, id, lotConfig, mk, nextId, run } from '../decide-helpers.js';

// Seeded like the other property files; set GAVEL_PROPERTY_SEED / GAVEL_PROPERTY_RUNS to replay.
const SEED = PROPERTY_SEED;
const NUM_RUNS = runsFor('exposure', 300);
const params = { seed: SEED, numRuns: NUM_RUNS };

const L3 = id('M3');
const LOTS: readonly Ulid[] = [L1, L2, L3];
const BIDDERS: readonly Ulid[] = [A, B, C];

type Scope = 'event' | 'lot';

interface Op {
  kind: 'bid' | 'hammer' | 'tick' | 'complete' | 'promote' | 'revoke' | 'open';
  who: number;
  lot: number;
  amount: number;
  dt: number;
  early: boolean;
}

const op: fc.Arbitrary<Op> = fc.record({
  kind: fc.constantFrom(
    'bid',
    'bid',
    'bid',
    'bid',
    'hammer',
    'tick',
    'complete',
    'promote',
    'promote',
    'revoke',
    'open',
  ) as fc.Arbitrary<Op['kind']>,
  who: fc.integer({ min: 0, max: 2 }),
  lot: fc.integer({ min: 0, max: 2 }),
  amount: fc.integer({ min: 100, max: 30000 }),
  dt: fc.integer({ min: 0, max: 6000 }),
  early: fc.boolean(),
});

const scenario = fc.record({
  scope: fc.constantFrom<Scope>('event', 'lot'),
  ceilings: fc.array(fc.integer({ min: 2000, max: 30000 }), { minLength: 3, maxLength: 3 }),
  modes: fc.array(fc.constantFrom<Mode>('english', 'proxy', 'second_price'), {
    minLength: 3,
    maxLength: 3,
  }),
  depth: fc.integer({ min: 0, max: 3 }),
  ops: fc.array(op, { minLength: 1, maxLength: 60 }),
});

type Scenario = {
  scope: Scope;
  ceilings: number[];
  modes: Mode[];
  depth: number;
  ops: Op[];
};

function lotFor(lotId: Ulid, mode: Mode): LotConfig {
  return lotConfig(lotId, { mode, reserveCents: 100, increment: { flatCents: 50 } });
}

function setup(sc: Scenario): AuctionState {
  let s: AuctionState = initialState;
  const step = (body: Parameters<typeof mk>[1]): void => {
    s = run(s, mk(0, body)).state;
  };
  step({
    type: 'CreateAuction',
    title: 'Gala',
    config: { holdScope: sc.scope, maxFallbackDepth: sc.depth, maxCeilingCents: 100000 },
  });
  LOTS.forEach((lotId, i) =>
    step({ type: 'AddLot', lot: lotFor(lotId, sc.modes[i] ?? 'english') }),
  );
  BIDDERS.forEach((bidderId, i) => {
    const ceilingCents = sc.ceilings[i] ?? 2000;
    if (sc.scope === 'event') step({ type: 'RegisterBidder', bidderId, ceilingCents });
    else for (const lotId of LOTS) step({ type: 'RegisterBidder', bidderId, ceilingCents, lotId });
  });
  return s;
}

/** The command an op stands for in the current state, or null when it does not apply. */
function commandFor(s: AuctionState, o: Op, at: number): Command | null {
  const lotId = LOTS[o.lot] ?? L1;
  const bidderId = BIDDERS[o.who] ?? A;
  const lot = s.lots[lotId];
  switch (o.kind) {
    case 'bid':
      return mk(at, {
        type: 'PlaceBid',
        lotId,
        bidderId,
        amountCents: o.amount,
        source: 'manual',
        audit: {},
      });
    case 'hammer':
      return mk(at, { type: 'Hammer', lotId, early: o.early, actor: 'prop' });
    case 'tick':
      return mk(at, { type: 'Tick' });
    case 'complete':
      if (lot === undefined || lot.winnerId === null || lot.priceCents === null) return null;
      return mk(at, {
        type: 'CompleteLot',
        lotId,
        bidderId: lot.winnerId,
        capturedCents: lot.priceCents,
        ref: 'prop',
      });
    case 'promote':
      if (lot === undefined || lot.winnerId === null) return null;
      return mk(at, {
        type: 'PromoteRunnerUp',
        lotId,
        disqualifiedBidderId: lot.winnerId,
        reason: 'prop',
      });
    case 'revoke':
      // Revocations are rare so that most runs keep a live field of bidders.
      return o.amount % 5 === 0
        ? mk(at, { type: 'RevokeCeiling', bidderId, reason: 'declined' })
        : null;
    case 'open': {
      const next = s.lotOrder.find((x) => s.lots[x]?.status === 'PENDING');
      return next === undefined ? null : mk(at, { type: 'OpenLot', lotId: next });
    }
  }
}

function ceilingOf(s: AuctionState, bidderId: Ulid, lotId: Ulid): number {
  return bidderFor(s, bidderId, lotId)?.ceilingCents ?? 0;
}

/** Captured and committed totals of every bidder, per holdScope key, never above the ceiling. */
function checkCeilings(s: AuctionState): void {
  for (const bidderId of BIDDERS) {
    const keys = new Set(LOTS.map((l) => scopeKey(s, l)));
    for (const key of keys) {
      const lotId = (s.config.holdScope === 'event' ? L1 : key) as Ulid;
      const ceiling = ceilingOf(s, bidderId, lotId);
      let captured = 0;
      for (const lot of Object.values(s.lots)) {
        if (scopeKey(s, lot.lotId) !== key) continue;
        if (lot.winnerId === bidderId && lot.capturedCents !== null) captured += lot.capturedCents;
      }
      expect(captured).toBeLessThanOrEqual(ceiling);
      expect(committed(s, bidderId, key)).toBeLessThanOrEqual(ceiling);
    }
  }
}

describe('ceiling and exposure properties', () => {
  it('T-ENG-031 R-ENG-043 R-ENG-069 no sequence of commands pushes committed or captured above a ceiling', () => {
    fc.assert(
      fc.property(scenario, (sc) => {
        let s = setup(sc);
        let at = 0;
        for (const o of sc.ops) {
          at += o.dt;
          const cmd = commandFor(s, o, at);
          if (cmd === null) continue;
          try {
            s = run(s, cmd).state;
          } catch (e) {
            // A refused command appends nothing; the engine may only refuse in its own terms.
            expect(e instanceof EngineError || e instanceof InvariantError).toBe(true);
          }
          checkCeilings(s);
        }
      }),
      params,
    );
  });

  it('T-ENG-051 R-ENG-069 an InvariantError leaves the state exactly as it was', () => {
    fc.assert(
      fc.property(scenario, (sc) => {
        let s = setup(sc);
        let at = 0;
        for (const o of sc.ops) {
          at += o.dt;
          const cmd = commandFor(s, o, at);
          if (cmd === null) continue;
          const before = s;
          try {
            s = run(s, cmd).state;
          } catch (e) {
            if (e instanceof InvariantError) expect(s).toBe(before);
          }
        }
      }),
      params,
    );
  });

  it('T-ENG-032 R-ENG-063 event scope: a hammer on lot 1 reduces the available ceiling on every later lot', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3000, max: 30000 }),
        fc.integer({ min: 100, max: 2000 }),
        (ceiling, wantPrice) => {
          let s: AuctionState = initialState;
          const go = (at: number, body: Parameters<typeof mk>[1]): AuctionState => {
            s = run(s, mk(at, body)).state;
            return s;
          };
          go(0, { type: 'CreateAuction', title: 'Gala', config: { holdScope: 'event' } });
          for (const lotId of [L1, L2, L3])
            go(0, { type: 'AddLot', lot: lotFor(lotId, 'english') });
          go(0, { type: 'RegisterBidder', bidderId: A, ceilingCents: ceiling });
          go(1, { type: 'OpenLot', lotId: L1 });
          const price = Math.min(wantPrice, ceiling - 200);
          go(2, {
            type: 'PlaceBid',
            lotId: L1,
            bidderId: A,
            amountCents: price,
            source: 'manual',
            audit: {},
          });
          go(3, { type: 'Hammer', lotId: L1, early: true, actor: 'prop' });
          expect(s.lots[L1]?.status).toBe('SETTLING');
          go(4, { type: 'OpenLot', lotId: L2 });
          for (const lotId of [L2, L3]) {
            expect(available(s, A, lotId)).toBe(ceiling - price);
          }
          const over = run(
            s,
            mk(5, {
              type: 'PlaceBid',
              lotId: L2,
              bidderId: A,
              amountCents: ceiling - price + 1,
              source: 'manual',
              audit: {},
            }),
          );
          expect(over.result.outcome).toEqual({ kind: 'rejected', reason: 'over_ceiling' });
          const fits = run(
            s,
            mk(5, {
              type: 'PlaceBid',
              lotId: L2,
              bidderId: A,
              amountCents: ceiling - price,
              source: 'manual',
              audit: {},
            }),
          );
          expect(fits.result.outcome).toEqual({ kind: 'accepted' });
        },
      ),
      params,
    );
  });

  it('T-ENG-051 R-ENG-066 R-ENG-069 a capture that differs from the hammer price is refused and the exact capture is booked', () => {
    const sc: Scenario = {
      scope: 'event',
      ceilings: [3000, 3000, 3000],
      modes: ['english', 'english', 'english'],
      depth: 2,
      ops: [],
    };
    let s = setup(sc);
    s = run(s, mk(1, { type: 'OpenLot', lotId: L1 })).state;
    s = run(
      s,
      mk(2, {
        type: 'PlaceBid',
        lotId: L1,
        bidderId: A,
        amountCents: 3000,
        source: 'manual',
        audit: {},
      }),
    ).state;
    s = run(s, mk(3, { type: 'Hammer', lotId: L1, early: true, actor: 'prop' })).state;
    s = captured(s, 3);
    expect(() =>
      run(s, {
        ...mk(4, { type: 'CompleteLot', lotId: L1, bidderId: A, capturedCents: 3001, ref: 'x' }),
        commandId: nextId(),
      }),
    ).toThrow(EngineError);
    const done = run(
      s,
      mk(4, { type: 'CompleteLot', lotId: L1, bidderId: A, capturedCents: 3000, ref: 'x' }),
    );
    expect(done.state.lots[L1]?.capturedCents).toBe(3000);
  });
});
