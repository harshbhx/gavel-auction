import { describe, expect, it } from 'vitest';
import { decide } from '../src/decide/index.js';
import { available } from '../src/rules/exposure.js';
import type { Body } from './decide-helpers.js';
import {
  A,
  B,
  L1,
  L2,
  bid,
  captured,
  errCode,
  lotConfig,
  mk,
  open,
  run,
  scene,
} from './decide-helpers.js';
import { initialState } from '../src/state.js';
import type { AuctionState } from '../src/state.js';
import type { Ulid } from '../src/types.js';

const hammer = (s: AuctionState, at: number, lotId = L1) =>
  run(s, mk(at, { type: 'Hammer', lotId, actor: 'host', early: true })).state;
const complete = (s: AuctionState, at: number, lotId: Ulid, cents: number) =>
  run(
    captured(s, at, lotId),
    mk(at, {
      type: 'CompleteLot',
      lotId,
      bidderId: s.lots[lotId]?.winnerId ?? A,
      capturedCents: cents,
      ref: 'c',
    }),
  ).state;
function withCeiling(s: AuctionState, bidderId: Ulid, ceilingCents: number): AuctionState {
  const b = s.bidders[bidderId];
  if (b === undefined) throw new Error('bidder missing');
  return { ...s, bidders: { ...s.bidders, [bidderId]: { ...b, ceilingCents } } };
}
const close = (at: number) => mk(at, { type: 'CloseAuction' });

describe('decide CloseAuction', () => {
  it('T-ENG-048 R-ENG-064 needs every lot DONE and anchors the head hash', () => {
    let s = open(scene({ lots: [lotConfig(L1)] }), L1);
    s = bid(s, 200, A, 2000).state;
    s = hammer(s, 300);
    expect(errCode(() => decide(s, close(310)))).toBe('auction_open_lots');
    s = complete(s, 320, L1, 2000);
    const r = run(s, close(330));
    expect(r.entries.map((e) => e.type)).toEqual(['AUCTION_CLOSED']);
    expect(r.entries[0]?.payload).toEqual({ headHash: s.head.hash });
    expect(r.state.closed).toBe(true);
    expect(errCode(() => decide(r.state, close(340)))).toBe('auction_closed');
    expect(
      errCode(() =>
        decide(r.state, mk(340, { type: 'RegisterBidder', bidderId: B, ceilingCents: 5 })),
      ),
    ).toBe('auction_closed');
  });

  it('T-ENG-048 R-ENG-064 a pending lot blocks closing, an unsold one does not', () => {
    let s = open(scene({ lots: [lotConfig(L1), lotConfig(L2)] }), L1);
    s = hammer(s, 300);
    expect(s.lots[L1]?.status).toBe('DONE');
    expect(errCode(() => decide(s, close(310)))).toBe('auction_open_lots');
    s = hammer(open(s, L2, 320), 330, L2);
    expect(decide(s, close(340)).events).toHaveLength(1);
  });

  it('T-ENG-047 R-ENG-063 event scope: a win reduces the ceiling on later lots', () => {
    let s = open(withCeiling(scene({ lots: [lotConfig(L1), lotConfig(L2)] }), B, 5000), L1);
    s = bid(s, 200, B, 3000).state;
    s = hammer(s, 300);
    s = open(s, L2, 320);
    expect(available(s, B, L2)).toBe(2000);
    expect(bid(s, 330, B, 2001, L2).entries[0]?.payload).toMatchObject({ reason: 'over_ceiling' });
    expect(bid(s, 330, B, 2000, L2).entries[0]?.type).toBe('BID_RECORDED');
  });

  it('T-ENG-047 R-ENG-063 lot scope keeps the full ceiling on the next lot', () => {
    let s = initialState;
    s = run(s, mk(0, { type: 'CreateAuction', title: 'Gala', config: { holdScope: 'lot' } })).state;
    for (const lot of [lotConfig(L1), lotConfig(L2)]) {
      s = run(s, mk(0, { type: 'AddLot', lot })).state;
      const reg = { type: 'RegisterBidder', bidderId: B, ceilingCents: 5000, lotId: lot.lotId };
      s = run(s, mk(0, reg as Body)).state;
    }
    s = open(s, L1);
    s = bid(s, 200, B, 3000).state;
    s = hammer(s, 300);
    s = open(s, L2, 320);
    expect(available(s, B, L2)).toBe(5000);
  });
});
