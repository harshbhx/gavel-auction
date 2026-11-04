import { describe, expect, it } from 'vitest';
import { decide } from '../src/decide/index.js';
import type { Command } from '../src/commands.js';
import type { AuctionState } from '../src/state.js';
import { A, B, C, L1, bid, id, mk, open, run, scene } from './decide-helpers.js';

const placeBid = (amountCents: number, commandId = id('R2B1')): Command =>
  mk(
    200,
    { type: 'PlaceBid', lotId: L1, bidderId: A, amountCents, source: 'manual', audit: {} },
    commandId,
  );

describe('red-team round 2 blocking (engine)', () => {
  it('ENG-R2-01: a retried bid with an out-of-range amount is a duplicate', () => {
    for (const amount of [-5, 0, -0, 100_000_001, 1.5, Number.NaN]) {
      const s = open(scene(), L1);
      const cmd = placeBid(amount);
      const first = run(s, cmd);
      expect(first.result.outcome).toEqual({ kind: 'rejected', reason: 'bad_amount' });
      expect(decide(first.state, cmd).outcome).toEqual({
        kind: 'duplicate',
        original: { kind: 'rejected', reason: 'bad_amount' },
      });
    }
  });

  it('ENG-R2-02: a retried promotion that ends unsold is a duplicate, not a conflict', () => {
    let s: AuctionState = open(scene({ config: { fallbackPolicy: 'unsold' } }), L1);
    s = bid(s, 200, A, 1000).state;
    s = bid(s, 210, B, 1500).state;
    s = bid(s, 220, C, 2000).state;
    s = run(s, mk(300, { type: 'Hammer', lotId: L1, actor: 'host', early: true })).state;
    const promote = mk(
      400,
      { type: 'PromoteRunnerUp', lotId: L1, disqualifiedBidderId: C, reason: 'hold_failed' },
      id('R2P1'),
    );
    const done = run(s, promote);
    expect(done.entries.map((e) => e.type)).toEqual(['LOT_UNSOLD']);
    expect(decide(done.state, promote).outcome).toEqual({
      kind: 'duplicate',
      original: { kind: 'accepted' },
    });
  });

  it('ENG-R2-02: a retried promotion that skips candidates then ends unsold is a duplicate', () => {
    let s: AuctionState = open(scene(), L1);
    s = bid(s, 200, A, 1000).state;
    s = bid(s, 210, B, 1500).state;
    s = run(s, mk(300, { type: 'Hammer', lotId: L1, actor: 'host', early: true })).state;
    const revoke = mk(310, { type: 'RevokeCeiling', bidderId: A, reason: 'declined' });
    s = run(s, revoke).state;
    const promote = mk(
      400,
      { type: 'PromoteRunnerUp', lotId: L1, disqualifiedBidderId: B, reason: 'hold_failed' },
      id('R2P2'),
    );
    const done = run(s, promote);
    expect(done.entries.map((e) => e.type)).toEqual(['CANDIDATE_SKIPPED', 'LOT_UNSOLD']);
    expect(decide(done.state, promote).outcome.kind).toBe('duplicate');
  });
});
