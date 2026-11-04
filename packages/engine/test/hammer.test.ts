import { describe, expect, it } from 'vitest';
import { decide, nextDeadline } from '../src/decide/index.js';
import { A, B, C, L1, bid, errCode, lotConfig, mk, open, run, scene } from './decide-helpers.js';

const hammer = (at: number, early?: boolean) =>
  mk(at, { type: 'Hammer', lotId: L1, actor: 'host:1', ...(early === undefined ? {} : { early }) });

describe('decide Hammer and Tick', () => {
  it('T-ENG-036 R-ENG-047 R-ENG-052 hammer needs CLOSING or an early flag', () => {
    const s = open(scene(), L1);
    expect(errCode(() => decide(s, hammer(200)))).toBe('cannot_hammer');
    const sold = bid(s, 150, A, 1000).state;
    const r = run(sold, hammer(200, true));
    expect(r.entries.map((e) => e.type)).toEqual(['LOT_CLOSING', 'LOT_HAMMERED']);
    expect(r.entries[0]?.payload).toEqual({ lotId: L1, reason: 'early' });
    expect(r.entries[1]?.payload).toMatchObject({
      actor: 'host:1',
      closedAtSeq: r.entries[0]?.seq,
    });
    expect(r.state.lots[L1]?.status).toBe('SETTLING');
    expect(errCode(() => decide(r.state, hammer(300, true)))).toBe('cannot_hammer');
    expect(errCode(() => decide(r.state, hammer(300)))).toBe('cannot_hammer');
  });

  it('T-ENG-037 R-ENG-048 R-ENG-050 R-ENG-051 english hammer payload and candidates', () => {
    let s = open(scene({ config: { maxFallbackDepth: 2 } }), L1);
    s = bid(s, 200, A, 1000).state;
    s = bid(s, 300, B, 1500).state;
    s = bid(s, 400, C, 2000).state;
    s = run(s, mk(10100, { type: 'Tick' })).state;
    const seqBefore = s.head.seq;
    const r = run(s, hammer(10200));
    expect(r.entries.map((e) => e.type)).toEqual(['LOT_HAMMERED']);
    const p = r.entries[0]?.payload as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(
      [
        'actor',
        'candidates',
        'closedAtSeq',
        'endsAt',
        'extensions',
        'lotId',
        'mode',
        'priceCents',
        'ranking',
        'winnerId',
      ].sort(),
    );
    expect(p).toMatchObject({
      winnerId: C,
      priceCents: 2000,
      mode: 'english',
      endsAt: 10100,
      extensions: 0,
      closedAtSeq: seqBefore,
      candidates: [
        { bidderId: C, priceCents: 2000 },
        { bidderId: B, priceCents: 1500 },
        { bidderId: A, priceCents: 1000 },
      ],
    });
    expect((p['ranking'] as unknown[]).length).toBe(3);
    expect(r.state.lots[L1]?.winnerId).toBe(C);
    expect(r.state.lots[L1]?.priceCents).toBe(2000);
  });

  it('R-ENG-050 proxy and second_price hammer prices', () => {
    const proxy = open(scene({ lots: [lotConfig(L1, { mode: 'proxy' })] }), L1);
    let s = bid(proxy, 200, A, 5000).state;
    s = bid(s, 300, B, 3000).state;
    s = run(s, hammer(400, true)).state;
    expect(s.lots[L1]?.winnerId).toBe(A);
    expect(s.lots[L1]?.priceCents).toBe(3100);

    const sealed = open(scene({ lots: [lotConfig(L1, { mode: 'second_price' })] }), L1);
    let t = bid(sealed, 200, A, 5000).state;
    t = bid(t, 300, B, 3000).state;
    t = run(t, hammer(400, true)).state;
    expect(t.lots[L1]?.priceCents).toBe(3000);
    let one = bid(sealed, 200, A, 5000).state;
    one = run(one, hammer(400, true)).state;
    expect(one.lots[L1]?.priceCents).toBe(1000);
  });

  it('T-ENG-038 R-ENG-049 R-ENG-068 no bids ends the lot unsold and DONE', () => {
    const s = open(scene(), L1);
    const r = run(s, hammer(200, true));
    expect(r.entries.map((e) => e.type)).toEqual(['LOT_CLOSING', 'LOT_UNSOLD']);
    expect(r.entries[1]?.payload).toEqual({ lotId: L1, reason: 'no_bids' });
    expect(r.state.lots[L1]?.status).toBe('DONE');
    expect(errCode(() => bid(r.state, 300, A, 1000))).toBe('lot_done');
    expect(errCode(() => decide(r.state, hammer(300, true)))).toBe('lot_done');
  });

  it('T-ENG-039 R-ENG-053 nextDeadline and Tick', () => {
    const s = open(scene(), L1);
    expect(nextDeadline(scene())).toBeNull();
    expect(nextDeadline(s)).toBe(10100);
    const early = run(s, mk(10099, { type: 'Tick' }));
    expect(early.entries).toEqual([]);
    expect(early.result.outcome).toEqual({ kind: 'noop' });
    const due = run(s, mk(10100, { type: 'Tick' }));
    expect(due.entries.map((e) => e.type)).toEqual(['LOT_CLOSING']);
    expect(due.entries[0]?.payload).toEqual({ lotId: L1, reason: 'deadline' });
    expect(nextDeadline(due.state)).toBeNull();
    expect(run(due.state, mk(10200, { type: 'Tick' })).result.outcome).toEqual({ kind: 'noop' });
  });

  it('R-ENG-026 hammer refuses a price above the winner ceiling', () => {
    let s = open(scene(), L1);
    s = bid(s, 200, A, 1000).state;
    const bidder = s.bidders[A];
    if (bidder === undefined) throw new Error('missing bidder');
    const broke = { ...s, bidders: { ...s.bidders, [A]: { ...bidder, ceilingCents: 500 } } };
    expect(errCode(() => decide(broke, hammer(300, true)))).toBe('price_over_ceiling');
  });
});
