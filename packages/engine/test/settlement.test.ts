import { describe, expect, it } from 'vitest';
import { decide } from '../src/decide/index.js';
import { InvariantError } from '../src/errors.js';
import { parseCommand } from '../src/commands.js';
import { A, B, L1, L2, bid, errCode, lotConfig, mk, open, run, scene } from './decide-helpers.js';
import type { AuctionState } from '../src/state.js';
import { SETTLEMENT_STATES } from '../src/events.js';

function hammered(price: number, config?: Record<string, unknown>): AuctionState {
  let s = open(scene(config === undefined ? {} : { config }), L1);
  s = bid(s, 200, A, price).state;
  return run(s, mk(300, { type: 'Hammer', lotId: L1, actor: 'host', early: true })).state;
}

function lowerCeiling(s: AuctionState, ceilingCents: number): AuctionState {
  const bidder = s.bidders[A];
  if (bidder === undefined) throw new Error('bidder missing');
  return { ...s, bidders: { ...s.bidders, [A]: { ...bidder, ceilingCents } } };
}

const complete = (at: number, capturedCents: number) =>
  mk(at, { type: 'CompleteLot', lotId: L1, bidderId: A, capturedCents, ref: 'cap-1' });
const settle = (at: number, from: string, to: string) =>
  mk(at, {
    type: 'RecordSettlement',
    lotId: L1,
    from: from as (typeof SETTLEMENT_STATES)[number],
    to: to as (typeof SETTLEMENT_STATES)[number],
    ref: 'r',
  });

describe('decide CompleteLot and RecordSettlement', () => {
  it('T-ENG-049 R-ENG-066 R-ENG-068 capture must equal the price', () => {
    const s = hammered(2000);
    expect(errCode(() => decide(s, complete(400, 1500)))).toBe('capture_mismatch');
    const r = run(s, complete(400, 2000));
    expect(r.entries.map((e) => e.type)).toEqual(['LOT_SETTLED']);
    expect(r.state.lots[L1]?.status).toBe('DONE');
    expect(errCode(() => decide(r.state, complete(500, 2000)))).toBe('lot_done');
    expect(errCode(() => decide(r.state, settle(500, 'HELD', 'CAPTURING')))).toBe('lot_done');
  });

  it('ENG-91 R-ENG-066 a capture booked to anyone but the winner is refused', () => {
    const s = hammered(2000);
    const wrong = mk(400, {
      type: 'CompleteLot',
      lotId: L1,
      bidderId: B,
      capturedCents: 2000,
      ref: 'cap-1',
    });
    expect(errCode(() => decide(s, wrong))).toBe('not_current_winner');
    const ok = run(s, complete(400, 2000));
    expect(ok.entries[0]?.payload).toMatchObject({ winnerId: A, capturedCents: 2000 });
    expect(() => parseCommand({ ...complete(400, 2000), bidderId: undefined })).toThrow();
  });

  it('T-ENG-049 R-ENG-066 a lot that was not hammered cannot be completed', () => {
    const s = open(scene(), L1);
    expect(errCode(() => decide(s, complete(400, 2000)))).toBe('bad_command');
    expect(
      errCode(() =>
        decide(
          scene(),
          mk(5, { type: 'CompleteLot', lotId: L2, bidderId: A, capturedCents: 1, ref: 'x' }),
        ),
      ),
    ).toBe('bad_command');
  });

  it('T-ENG-050 R-ENG-067 settlement states must continue from the last one', () => {
    const s = hammered(2000);
    const a = run(s, settle(400, 'HELD', 'CAPTURING'));
    expect(a.entries.map((e) => e.type)).toEqual(['SETTLEMENT_STATE']);
    expect(a.state.lots[L1]?.settlement).toBe('CAPTURING');
    expect(errCode(() => decide(a.state, settle(500, 'HELD', 'CAPTURED')))).toBe(
      'state_continuity',
    );
    expect(errCode(() => decide(a.state, settle(500, 'CAPTURING', 'PAID')))).toBe('bad_command');
    expect(errCode(() => decide(a.state, settle(500, 'NOPE', 'CAPTURED')))).toBe('bad_command');
  });

  it('T-ENG-051 R-ENG-069 captured total above the ceiling is an invariant failure', () => {
    const s = hammered(2000);
    expect(lowerCeiling(s, 1500)).toBeDefined();
    expect(() => decide(lowerCeiling(s, 1500), complete(400, 2000))).toThrow(InvariantError);
    expect(decide(lowerCeiling(s, 2000), complete(400, 2000)).events).toHaveLength(1);
  });

  it('T-ENG-051 R-ENG-069 event scope sums captured cents of every lot of the bidder', () => {
    let s = open(scene({ lots: [lotConfig(L1), lotConfig(L2)] }), L1);
    s = bid(s, 200, A, 60000).state;
    s = run(s, mk(300, { type: 'Hammer', lotId: L1, actor: 'host', early: true })).state;
    s = run(s, complete(310, 60000)).state;
    s = open(s, L2, 320);
    s = bid(s, 330, A, 25000, L2).state;
    s = run(s, mk(340, { type: 'Hammer', lotId: L2, actor: 'host', early: true })).state;
    const done = mk(350, {
      type: 'CompleteLot',
      lotId: L2,
      bidderId: A,
      capturedCents: 25000,
      ref: 'c2',
    });
    expect(() => decide(lowerCeiling(s, 80000), done)).toThrow(InvariantError);
    expect(decide(lowerCeiling(s, 85000), done).events).toHaveLength(1);
  });
});
