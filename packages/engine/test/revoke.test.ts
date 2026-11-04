import { describe, expect, it } from 'vitest';
import { decide } from '../src/decide/index.js';
import { A, B, C, L1, bid, errCode, mk, open, run, scene } from './decide-helpers.js';

const revoke = (at: number, bidderId: typeof A, reason: 'declined' | 'expired' = 'declined') =>
  mk(at, { type: 'RevokeCeiling', bidderId, reason });

describe('decide RevokeCeiling', () => {
  it('T-ENG-034 R-ENG-044 R-ENG-029 revoking the leader strikes its bids and re-ranks', () => {
    let s = open(scene(), L1);
    s = bid(s, 200, A, 2000).state;
    s = bid(s, 300, B, 2500).state;
    s = bid(s, 400, A, 3000).state;
    const r = run(s, revoke(500, A));
    expect(r.entries.map((e) => e.type)).toEqual(['CEILING_REVOKED', 'BID_STRUCK', 'BID_STRUCK']);
    expect(r.entries[0]?.payload).toEqual({ bidderId: A, reason: 'declined' });
    const lot = r.state.lots[L1];
    expect(lot?.leaderId).toBe(B);
    expect(lot?.best[B]?.amountCents).toBe(2500);
    const again = bid(r.state, 600, A, 4000);
    expect(again.result.outcome).toEqual({ kind: 'rejected', reason: 'ceiling_revoked' });
    const unknown = bid(r.state, 600, C, 4000);
    expect(unknown.result.outcome.kind).toBe('rejected');
    expect(errCode(() => decide(r.state, revoke(700, 'ZZ' as typeof A)))).toBe('bad_id');
  });

  it('T-ENG-035 R-ENG-044 after the hammer only the revocation is recorded', () => {
    let s = open(scene(), L1);
    s = bid(s, 200, A, 2000).state;
    s = run(s, mk(300, { type: 'Hammer', lotId: L1, actor: 'host', early: true })).state;
    const before = s.lots[L1];
    const r = run(s, revoke(400, A, 'expired'));
    expect(r.entries.map((e) => e.type)).toEqual(['CEILING_REVOKED']);
    expect(r.state.lots[L1]?.status).toBe(before?.status);
    expect(r.state.lots[L1]?.winnerId).toBe(before?.winnerId);
    expect(r.state.lots[L1]?.priceCents).toBe(before?.priceCents);
  });

  it('R-ENG-044 a repeated revocation is a noop and an unknown bidder fails', () => {
    const s = scene();
    const first = run(s, revoke(10, A));
    expect(first.result.outcome.kind).toBe('accepted');
    const second = run(first.state, revoke(20, A));
    expect(second.result).toEqual({ events: [], outcome: { kind: 'noop' } });
    expect(errCode(() => decide(s, revoke(10, '01ZZZZZZZZZZZZZZZZZZZZZZZZ' as typeof A)))).toBe(
      'bad_command',
    );
  });
});
