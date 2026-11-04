import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/canonical.js';
import type { JsonValue } from '../src/canonical.js';
import { decide } from '../src/decide/index.js';
import { initialState, type AuctionState } from '../src/state.js';
import type { SettlementState } from '../src/events.js';
import { A, B, L1, L2, bid, errCode, lotConfig, mk, open, run, scene } from './decide-helpers.js';

const settle = (at: number, from: SettlementState, to: SettlementState) =>
  mk(at, { type: 'RecordSettlement', lotId: L1, from, to, ref: 'r' });
const step = (s: AuctionState, at: number, from: SettlementState, to: SettlementState) =>
  run(s, settle(at, from, to)).state;
const hammered = (): AuctionState => {
  const s = bid(open(scene(), L1), 200, A, 2000).state;
  return run(s, mk(300, { type: 'Hammer', lotId: L1, actor: 'host', early: true })).state;
};
const promote = (s: AuctionState, at: number) =>
  run(
    s,
    mk(at, { type: 'PromoteRunnerUp', lotId: L1, disqualifiedBidderId: A, reason: 'declined' }),
  );

describe('red team round 4 engine fixes', () => {
  it('T-ENG-048 R4-E02 R-ENG-064 a release still to be recorded can be recorded after the auction closed', () => {
    const unsold = promote(hammered(), 400).state;
    expect(unsold.lots[L1]?.settlement).toBe('VOIDING');
    const closed = run(unsold, mk(500, { type: 'CloseAuction' })).state;
    expect(closed.closed).toBe(true);
    const released = run(closed, settle(600, 'VOIDING', 'SETTLED')).state;
    expect(released.lots[L1]?.settlement).toBe('SETTLED');
    expect(errCode(() => decide(released, settle(700, 'SETTLED', 'SETTLED')))).toBe(
      'auction_closed',
    );
  });

  it('T-ENG-053 R4-E07 R-ENG-071 non-plain objects and extended arrays are not canonical', () => {
    const bad: unknown[] = [
      new Map([[1, 2]]),
      new Set([1]),
      new Date(0),
      Object.assign([1], { x: 1 }),
    ];
    for (const v of bad) expect(() => canonicalize(v as JsonValue)).toThrow();
    expect(canonicalize(Object.assign(Object.create(null) as object, { a: 1 }) as JsonValue)).toBe(
      '{"a":1}',
    );
  });

  it('T-ENG-034 R4-E09 R-ENG-044 a revoked bidder cannot register for another lot under lot-scoped holds', () => {
    let s = run(
      initialState,
      mk(0, { type: 'CreateAuction', title: 'Gala', config: { holdScope: 'lot' } }),
    ).state;
    for (const lot of [lotConfig(L1), lotConfig(L2)]) {
      s = run(s, mk(0, { type: 'AddLot', lot })).state;
    }
    s = run(s, mk(1, { type: 'RegisterBidder', bidderId: B, ceilingCents: 5000, lotId: L1 })).state;
    s = run(s, mk(2, { type: 'RevokeCeiling', bidderId: B, reason: 'declined' })).state;
    const again = mk(3, { type: 'RegisterBidder', bidderId: B, ceilingCents: 5000, lotId: L2 });
    expect(errCode(() => decide(s, again))).toBe('bad_command');
  });

  it('T-ENG-049 R4-E10 R-ENG-067 an unsold lot mid capture records the fallback step before the release', () => {
    let s = hammered();
    s = step(s, 310, 'HELD', 'BIDDING');
    s = step(s, 320, 'BIDDING', 'WINNER_SELECTED');
    s = step(s, 330, 'WINNER_SELECTED', 'CAPTURING');
    const r = promote(s, 400);
    expect(r.entries.map((e) => e.type)).toEqual(['SETTLEMENT_STATE', 'LOT_UNSOLD']);
    expect(r.state.lots[L1]?.settlement).toBe('VOIDING');
    expect(step(r.state, 500, 'VOIDING', 'SETTLED').lots[L1]?.settlement).toBe('SETTLED');
  });

  it('T-ENG-049 R4-E10 R-ENG-067 an unsold lot waiting for review keeps that state', () => {
    let s = hammered();
    s = step(s, 310, 'HELD', 'BIDDING');
    s = step(s, 320, 'BIDDING', 'WINNER_SELECTED');
    s = step(s, 330, 'WINNER_SELECTED', 'FAILED_NEEDS_REVIEW');
    expect(promote(s, 400).state.lots[L1]?.settlement).toBe('FAILED_NEEDS_REVIEW');
  });
});
