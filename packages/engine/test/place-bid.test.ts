import { describe, expect, it } from 'vitest';
import { decide } from '../src/decide/index.js';
import type { BidAudit } from '../src/events.js';
import { stateDigest } from '../src/replay.js';
import { LIMITS } from '../src/types.js';
import { A, B, L1, bid, errCode, lotConfig, mk, open, run, scene } from './decide-helpers.js';

const soft = { windowMs: 30000, extensionMs: 30000, maxExtensions: 3 };

describe('decide PlaceBid', () => {
  it('T-ENG-024 R-ENG-031 R-ENG-082 a rejected bid appends exactly one BID_REJECTED', () => {
    const s = open(scene(), L1);
    const r = bid(s, 200, A, 500); // below reserve
    expect(r.entries.map((e) => e.type)).toEqual(['BID_REJECTED']);
    expect(r.result.outcome).toEqual({ kind: 'rejected', reason: 'below_reserve' });
    const strip = (st: typeof s) =>
      stateDigest({
        ...st,
        head: s.head,
        commands: {},
        lots: Object.fromEntries(
          Object.entries(st.lots).map(([k, l]) => [k, { ...l, rejectedBids: 0 }]),
        ),
      });
    expect(strip(r.state)).toBe(strip(s));
    expect(r.state.lots[L1]?.bids).toEqual([]);
    expect(r.entries[0]?.payload).toMatchObject({ amountCents: 500, reason: 'below_reserve' });
  });

  it('T-ENG-024 R-ENG-082 a non-integer amount is stored as amountRaw', () => {
    const s = open(scene(), L1);
    const r = bid(s, 200, A, 150.5);
    expect(r.entries[0]?.payload).toMatchObject({
      amountCents: null,
      amountRaw: '150.5',
      reason: 'bad_amount',
    });
    const long = bid(s, 200, A, 1.5e300);
    const p = long.entries[0]?.payload as { amountRaw: string };
    expect(p.amountRaw.length).toBeLessThanOrEqual(40);
  });

  it('T-ENG-025 R-ENG-032 a struck bid stays in the lot record and no command removes bids', () => {
    let s = open(scene(), L1);
    s = bid(s, 200, A, 1000).state;
    expect(s.lots[L1]?.bids).toHaveLength(1);
    const cmds = ['CancelBid', 'WithdrawBid', 'EditBid'];
    for (const type of cmds) {
      expect(errCode(() => decide(s, { ...mk(300, { type: 'Tick' }), type } as never))).toBe(
        'bad_command',
      );
    }
  });

  it('T-ENG-026 R-ENG-033 R-ENG-035 a bid at endsAt closes the lot and is rejected', () => {
    const s = open(scene(), L1); // endsAt 10100
    const late = bid(s, 10100, A, 1000);
    expect(late.entries.map((e) => e.type)).toEqual(['LOT_CLOSING', 'BID_REJECTED']);
    expect(late.entries.map((e) => e.at)).toEqual([10100, 10100]);
    expect(late.entries[0]?.payload).toEqual({ lotId: L1, reason: 'deadline' });
    expect(late.entries[1]?.payload).toMatchObject({ reason: 'lot_not_open' });
    expect(late.state.lots[L1]?.status).toBe('CLOSING');
    const ok = bid(s, 10099, A, 1000);
    expect(ok.entries.map((e) => e.type)).toEqual(['BID_RECORDED']);
  });

  it('T-ENG-027 R-ENG-034 R-ENG-038 R-ENG-039 soft close extends after the recorded bid', () => {
    const cfg = lotConfig(L1, { durationMs: 100000, softClose: soft });
    let s = open(scene({ lots: [cfg] }), L1, 0); // endsAt 100000
    expect(bid(s, 69999, A, 1000).entries.map((e) => e.type)).toEqual(['BID_RECORDED']);
    const at70 = bid(s, 70000, A, 1000);
    // The window opens at 70000 but the end time would not move, so nothing is extended.
    expect(at70.entries.map((e) => e.type)).toEqual(['BID_RECORDED']);
    expect(at70.state.lots[L1]?.endsAt).toBe(100000);
    expect(at70.state.lots[L1]?.extensions).toBe(0);
    const late = bid(s, 99999, A, 1000);
    expect(late.state.lots[L1]?.endsAt).toBe(129999);
    expect(late.entries[1]?.payload).toEqual({
      lotId: L1,
      endsAtBefore: 100000,
      endsAtAfter: 129999,
      extensions: 1,
      triggerBidId: late.entries[0]?.cmd,
    });
    s = late.state;
    const rejected = bid(s, 100000, B, 5);
    expect(rejected.state.lots[L1]?.endsAt).toBe(129999);
    expect(rejected.state.lots[L1]?.extensions).toBe(1);
  });

  it('T-ENG-028 R-ENG-036 extensions stop at maxExtensions and hardCloseMs', () => {
    const cfg = lotConfig(L1, {
      durationMs: 100000,
      softClose: { ...soft, hardCloseMs: 120000 },
    });
    let s = open(scene({ lots: [cfg] }), L1, 0);
    let amount = 1000;
    for (let i = 0; i < 6; i++) {
      const end = s.lots[L1]?.endsAt ?? 0;
      s = bid(s, end - 1, i % 2 === 0 ? A : B, (amount += 100)).state;
      expect(s.lots[L1]?.endsAt ?? 0).toBeLessThanOrEqual(120000);
    }
    // The first bid extends to the hard close; later bids would not move it.
    expect(s.lots[L1]?.extensions).toBe(1);
    expect(s.lots[L1]?.endsAt).toBe(120000);
  });

  it('T-ENG-029 R-ENG-081 R-ENG-083 R-ENG-084 an accepted voice bid carries the full payload', () => {
    const audit: BidAudit = {
      utteranceId: 'u-81',
      audioStartMs: 1,
      audioEndMs: 2,
      transcript: 'one thousand',
      confidenceBps: 9120,
      confirmed: true,
      parserVersion: 'p1',
      clientTs: 5,
    };
    const s = open(scene(), L1);
    const first = bid(s, 200, A, 1000, L1, { source: 'voice', audit });
    const p = first.entries[0]?.payload as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(
      [
        'amountCents',
        'audit',
        'bidId',
        'bidderId',
        'endsAtAfter',
        'endsAtBefore',
        'leaderAfter',
        'leaderBefore',
        'lotId',
        'priceAfter',
        'priceBefore',
        'rank',
        'source',
      ].sort(),
    );
    expect(p).toMatchObject({
      priceBefore: null,
      priceAfter: 1000,
      leaderBefore: null,
      leaderAfter: A,
      rank: 1,
      audit,
      endsAtBefore: 10100,
      endsAtAfter: 10100,
    });
    const second = bid(first.state, 300, B, 1100);
    expect(second.entries[0]?.payload).toMatchObject({
      priceBefore: 1000,
      priceAfter: 1100,
      leaderBefore: A,
      leaderAfter: B,
      rank: 1,
    });
    expect(errCode(() => bid(s, 200, A, 1000, L1, { source: 'phone' as never }))).toBe(
      'bad_command',
    );
    expect(errCode(() => bid(s, 200, A, 1000, L1, { audit: { confidenceBps: 10001 } }))).toBe(
      'bad_command',
    );
  });

  it('T-ENG-029 R-ENG-086 sealed lots keep real amounts and publish no price while open', () => {
    const cfg = lotConfig(L1, { mode: 'second_price' });
    const s = open(scene({ lots: [cfg] }), L1);
    const r = bid(s, 200, A, 5000);
    expect(r.entries[0]?.payload).toMatchObject({ amountCents: 5000, priceAfter: null });
  });

  it('T-ENG-030 R-ENG-085 clientTs does not change ordering or outcomes', () => {
    const s = open(scene(), L1);
    const run1 = (tsA: number, tsB: number) => {
      let st = bid(s, 200, A, 1000, L1, { audit: { clientTs: tsA } }).state;
      st = bid(st, 300, B, 1100, L1, { audit: { clientTs: tsB } }).state;
      const lot = st.lots[L1];
      return {
        leader: lot?.leaderId,
        endsAt: lot?.endsAt,
        order: lot?.bids.map((b) => [b.bidderId, b.amountCents, b.at, b.seq]),
      };
    };
    const x = run1(1000, 1);
    const y = run1(1, 1000);
    expect(x.leader).toBe(B);
    expect(x).toEqual(y);
  });

  it('R-ENG-068 a DONE lot accepts no bid', () => {
    let s = open(scene(), L1);
    s = run(s, mk(10100, { type: 'Tick' })).state;
    s = run(s, mk(10200, { type: 'Hammer', lotId: L1, actor: 'host' })).state;
    expect(s.lots[L1]?.status).toBe('DONE');
    expect(errCode(() => bid(s, 10300, A, 1000))).toBe('lot_done');
  });

  it('R-ENG-031 bids on a pending or unknown lot', () => {
    const s = scene();
    expect(bid(s, 200, A, 1000).result.outcome).toEqual({
      kind: 'rejected',
      reason: 'lot_not_open',
    });
    expect(errCode(() => bid(s, 200, A, 1000, B))).toBe('bad_command');
  });

  it('T-ENG-147 R-ENG-007 ENG-RT-14 rejected bids per lot are capped', () => {
    const s0 = open(scene(), L1);
    const lot = s0.lots[L1];
    if (lot === undefined) throw new Error('lot missing');
    const full = {
      ...s0,
      lots: { ...s0.lots, [L1]: { ...lot, rejectedBids: LIMITS.rejectedPerLot - 1 } },
    };
    const last = bid(full, 200, A, 500);
    expect(last.entries.map((e) => e.type)).toEqual(['BID_REJECTED']);
    expect(last.state.lots[L1]?.rejectedBids).toBe(LIMITS.rejectedPerLot);
    expect(errCode(() => bid(last.state, 210, A, 500))).toBe('limit_exceeded');
    expect(bid(last.state, 210, A, 1000).result.outcome.kind).toBe('accepted');
  });

  it('R-ENG-083 rejects an over-long transcript', () => {
    const s = open(scene(), L1);
    expect(
      errCode(() => bid(s, 200, A, 1000, L1, { audit: { transcript: 'x'.repeat(2001) } })),
    ).toBe('limit_exceeded');
  });
});
