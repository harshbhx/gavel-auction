import { describe, expect, it } from 'vitest';
import { decide } from '../src/decide/index.js';
import { committed } from '../src/rules/exposure.js';
import type { AuctionState } from '../src/state.js';
import type { Ulid } from '../src/types.js';
import {
  A,
  B,
  C,
  L1,
  L2,
  bid,
  errCode,
  lotConfig,
  mk,
  open,
  run,
  scene,
} from './decide-helpers.js';

function hammered(config?: Record<string, unknown>): AuctionState {
  let s = open(scene(config === undefined ? {} : { config }), L1);
  s = bid(s, 200, A, 1000).state;
  s = bid(s, 210, B, 1500).state;
  s = bid(s, 220, C, 2000).state;
  return run(s, mk(300, { type: 'Hammer', lotId: L1, actor: 'host', early: true })).state;
}

const promote = (at: number, who: Ulid, lotId: Ulid = L1) =>
  mk(at, { type: 'PromoteRunnerUp', lotId, disqualifiedBidderId: who, reason: 'hold_failed' });

describe('decide PromoteRunnerUp', () => {
  it('T-ENG-040 R-ENG-054 R-ENG-058 R-ENG-059 promotes the next candidate and moves the commitment', () => {
    const s = hammered();
    expect(committed(s, C, 'event')).toBe(2000);
    const r = run(s, promote(400, C));
    expect(r.entries.map((e) => e.type)).toEqual(['FALLBACK_PROMOTED']);
    expect(r.entries[0]?.payload).toEqual({
      lotId: L1,
      from: C,
      to: B,
      priceCents: 1500,
      depth: 1,
      reason: 'hold_failed',
    });
    expect(r.state.lots[L1]?.winnerId).toBe(B);
    expect(committed(r.state, B, 'event')).toBe(1500);
    expect(committed(r.state, C, 'event')).toBe(0);
  });

  it('T-ENG-045 R-ENG-054 only the current winner of a settling lot can be promoted past', () => {
    const s = hammered();
    expect(errCode(() => decide(s, promote(400, B)))).toBe('not_current_winner');
    const open1 = open(scene(), L1);
    expect(errCode(() => decide(open1, promote(400, A)))).toBe('cannot_promote');
    expect(errCode(() => decide(scene(), promote(400, A, L2)))).toBe('bad_command');
  });

  it('T-ENG-043 R-ENG-056 a candidate without headroom is skipped and the next one is tried', () => {
    const s0 = hammered();
    const b = s0.bidders[B];
    if (b === undefined) throw new Error('bidder missing');
    const s = { ...s0, bidders: { ...s0.bidders, [B]: { ...b, ceilingCents: 1000 } } };
    const r = run(s, promote(400, C));
    expect(r.entries.map((e) => e.type)).toEqual(['CANDIDATE_SKIPPED', 'FALLBACK_PROMOTED']);
    expect(r.entries[0]?.payload).toMatchObject({
      bidderId: B,
      reason: 'ceiling_insufficient',
      depth: 1,
      priceCents: 1500,
    });
    expect(r.entries[1]?.payload).toMatchObject({ to: A, depth: 2, priceCents: 1000 });
    expect(r.state.lots[L1]?.winnerId).toBe(A);
  });

  it('T-ENG-043 R-ENG-056 a revoked candidate is skipped with its own reason', () => {
    const s0 = hammered();
    const b = s0.bidders[B];
    if (b === undefined) throw new Error('bidder missing');
    const s = { ...s0, bidders: { ...s0.bidders, [B]: { ...b, revoked: true } } };
    const r = run(s, promote(400, C));
    expect(r.entries[0]?.payload).toMatchObject({ bidderId: B, reason: 'ceiling_revoked' });
  });

  it('T-ENG-044 R-ENG-057 passing maxFallbackDepth ends the lot unsold', () => {
    let s = hammered({ maxFallbackDepth: 1 });
    s = run(s, promote(400, C)).state;
    expect(s.lots[L1]?.depth).toBe(1);
    const r = run(s, promote(410, B));
    expect(r.entries.map((e) => e.type)).toEqual(['LOT_UNSOLD']);
    expect(r.entries[0]?.payload).toMatchObject({ reason: 'no_valid_winner' });
    expect(r.state.lots[L1]?.status).toBe('DONE');
    expect(committed(r.state, B, 'event')).toBe(0);
  });

  it('T-ENG-044 R-ENG-057 running out of candidates ends the lot unsold', () => {
    let s = hammered({ maxFallbackDepth: 5 });
    s = run(s, promote(400, C)).state;
    s = run(s, promote(410, B)).state;
    expect(s.lots[L1]?.winnerId).toBe(A);
    const r = run(s, promote(420, A));
    expect(r.entries.map((e) => e.type)).toEqual(['LOT_UNSOLD']);
  });

  it('T-ENG-044 R-ENG-060 policy unsold appends LOT_UNSOLD directly', () => {
    const r = run(hammered({ fallbackPolicy: 'unsold' }), promote(400, C));
    expect(r.entries.map((e) => e.type)).toEqual(['LOT_UNSOLD']);
    expect(r.state.lots[L1]?.unsoldReason).toBe('no_valid_winner');
  });

  it('T-ENG-043 R-ENG-043 event scope: a runner-up already committed elsewhere is skipped', () => {
    let s = open(scene({ lots: [lotConfig(L1), lotConfig(L2)] }), L1);
    s = bid(s, 200, B, 2000).state;
    s = run(s, mk(300, { type: 'Hammer', lotId: L1, actor: 'host', early: true })).state;
    s = open(s, L2, 400);
    s = bid(s, 410, B, 1500, L2).state;
    s = bid(s, 420, C, 2000, L2).state;
    s = run(s, mk(500, { type: 'Hammer', lotId: L2, actor: 'host', early: true })).state;
    const b = s.bidders[B];
    if (b === undefined) throw new Error('bidder missing');
    s = { ...s, bidders: { ...s.bidders, [B]: { ...b, ceilingCents: 3000 } } };
    const r = run(s, promote(600, C, L2));
    expect(r.entries[0]?.type).toBe('CANDIDATE_SKIPPED');
    expect(r.entries[0]?.payload).toMatchObject({ bidderId: B, reason: 'ceiling_insufficient' });
  });
});
