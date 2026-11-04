import { describe, expect, it } from 'vitest';
import { projectAuditor, projectBidder, projectPublic } from '../src/projections.js';
import type { LedgerEntry } from '../src/events.js';
import { A, B, L1, bid, lotConfig, mk, open, run, scene } from './decide-helpers.js';
import type { AuctionState } from '../src/state.js';

const alias = (id: string): string => (id === A ? 'Ann' : id === B ? 'Bob' : 'Guest');

function withHold(s: AuctionState): AuctionState {
  const b = s.bidders[A];
  if (b === undefined) throw new Error('bidder missing');
  return { ...s, bidders: { ...s.bidders, [A]: { ...b, holdRef: 'AUTH-123' } } };
}

describe('projections', () => {
  it('T-ENG-077 R-ENG-106 R-ENG-045 R-ENG-110 public view has aliases and no ceilings', () => {
    let s = open(withHold(scene()), L1);
    s = bid(s, 200, A, 1000).state;
    s = bid(s, 300, B, 1500).state;
    const view = projectPublic(s, alias);
    const json = JSON.stringify(view);
    for (const banned of ['ceilingCents', 'holdRef', 'committed', 'AUTH-123', A, B]) {
      expect(json).not.toContain(banned);
    }
    expect(view.lots[0]).toMatchObject({
      title: 'Vase',
      status: 'OPEN',
      priceCents: 1500,
      leaderAlias: 'Bob',
      bidCount: 2,
    });
  });

  it('T-ENG-078 R-ENG-107 bidder view carries only the own ceiling and bids', () => {
    let s = open(withHold(scene()), L1);
    s = bid(s, 200, A, 1000).state;
    s = bid(s, 300, B, 1500).state;
    const a = projectBidder(s, A, alias);
    expect(a.lots[0]?.own).toMatchObject({
      ceilingCents: 90000,
      committedCents: 0,
      availableCents: 90000,
    });
    expect(a.lots[0]?.own.bids.map((x) => x.amountCents)).toEqual([1000]);
    const b = JSON.stringify(projectBidder(s, B, alias));
    expect(b).not.toContain('AUTH-123');
    expect(b).not.toContain('1000');
  });

  it('T-ENG-079 R-ENG-109 R-ENG-108 R-ENG-023 sealed amounts stay hidden until the hammer', () => {
    const sealed = lotConfig(L1, { mode: 'second_price', reserveCents: 500 });
    let s = open(scene({ lots: [sealed] }), L1);
    const entries: LedgerEntry[] = [];
    const feed = (r: ReturnType<typeof bid>): void => {
      entries.push(...r.entries);
      s = r.state;
    };
    feed(bid(s, 200, A, 1234, L1, { audit: { transcript: 'bid 1234' } }));
    feed(bid(s, 300, B, 5678));
    const open_ = JSON.stringify(projectPublic(s, alias));
    expect(open_).not.toContain('1234');
    expect(open_).not.toContain('5678');
    expect(projectPublic(s, alias).lots[0]).toMatchObject({ priceCents: null, leaderAlias: null });

    const lotAdded = {
      type: 'LOT_ADDED',
      payload: { lotId: L1, lot: sealed },
    } as unknown as LedgerEntry;
    const hidden = JSON.stringify(projectAuditor([lotAdded, ...entries]));
    expect(hidden).not.toContain('1234');
    expect(hidden).not.toContain('5678');
    expect(hidden).toContain('"redacted":true');
    expect(JSON.stringify(projectAuditor([lotAdded, ...entries], { full: true }))).toContain(
      '1234',
    );

    const hammer = run(s, mk(400, { type: 'Hammer', lotId: L1, actor: 'host', early: true }));
    const after = JSON.stringify(projectAuditor([lotAdded, ...entries, ...hammer.entries]));
    expect(after).toContain('1234');
    expect(after).toContain('5678');
    expect(projectPublic(hammer.state, alias).lots[0]).toMatchObject({
      priceCents: 1234,
      leaderAlias: 'Bob',
    });
  });
});
