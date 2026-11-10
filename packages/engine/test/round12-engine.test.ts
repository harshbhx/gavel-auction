import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/commands.js';
import type { Command } from '../src/commands.js';
import { DEFAULT_AUCTION_CONFIG, LEDGER_V1_AUCTION_DEFAULTS } from '../src/config.js';
import { decide } from '../src/decide/index.js';
import { InvariantError } from '../src/errors.js';
import type { LedgerEvent, SettlementState } from '../src/events.js';
import { evolveAll } from '../src/evolve.js';
import { available } from '../src/rules/exposure.js';
import { hardCloseOf } from '../src/rules/softclose.js';
import { initialState } from '../src/state.js';
import type { AuctionState, LotState } from '../src/state.js';
import type { LotConfig, Ulid } from '../src/types.js';
import {
  A,
  AU,
  B,
  C,
  L1,
  L2,
  bid,
  captured,
  errCode,
  id,
  lotConfig,
  mk,
  open,
  run,
  scene,
} from './decide-helpers.js';
import { entriesFrom } from './entries.js';
import { SEED, runsFor } from './property-params.js';

const L3 = id('M3');
const P = id('BP');
const Q = id('BQ');
const LEAD = id('BD');

const settle = (
  s: AuctionState,
  at: number,
  from: SettlementState,
  to: SettlementState,
  ref = 'saga',
  lotId: Ulid = L1,
): AuctionState => run(s, mk(at, { type: 'RecordSettlement', lotId, from, to, ref })).state;
const settleCmd = (at: number, from: SettlementState, to: SettlementState, ref = 'saga') =>
  mk(at, { type: 'RecordSettlement', lotId: L1, from, to, ref });
const hammer = (s: AuctionState, at: number, lotId: Ulid = L1): AuctionState =>
  run(s, mk(at, { type: 'Hammer', lotId, actor: 'host', early: true })).state;
const promote = (at: number, who: Ulid, lotId: Ulid = L1, key?: Ulid): Command =>
  mk(at, { type: 'PromoteRunnerUp', lotId, disqualifiedBidderId: who, reason: 'declined' }, key);
const complete = (at: number, bidderId: Ulid, capturedCents: number): Command =>
  mk(at, { type: 'CompleteLot', lotId: L1, bidderId, capturedCents, ref: 'cap-1' });
const close = (at: number): Command => mk(at, { type: 'CloseAuction' });

/** A 1000 then B 1500 on L1, hammered early: B wins at 1500 with A as runner-up. */
function soldToB(config: Record<string, unknown> = {}): AuctionState {
  let s = open(scene({ config }), L1);
  s = bid(s, 200, A, 1000).state;
  s = bid(s, 210, B, 1500).state;
  return hammer(s, 300);
}

function created(config: Record<string, unknown>, lots: LotConfig[]): AuctionState {
  let s = run(initialState, mk(0, { type: 'CreateAuction', title: 'Gala', config })).state;
  for (const lot of lots) s = run(s, mk(0, { type: 'AddLot', lot })).state;
  return s;
}

const register = (s: AuctionState, bidderId: Ulid, ceilingCents: number, extra = {}) =>
  run(s, mk(s.head.at, { type: 'RegisterBidder', bidderId, ceilingCents, ...extra })).state;

describe('review round 12: settlement and money', () => {
  it('T-ENG-310 R12-E02 a captured lot whose release went to review is resolved, completed and closed', () => {
    let s = captured(soldToB(), 310);
    s = settle(s, 320, 'CAPTURED', 'VOIDING');
    s = settle(s, 330, 'VOIDING', 'FAILED_NEEDS_REVIEW');
    // Stuck before: no way to record the paid sale, so the auction never closes.
    expect(errCode(() => decide(s, complete(340, B, 1500)))).toBe('state_continuity');
    expect(errCode(() => decide(s, close(340)))).toBe('auction_open_lots');
    // A resolution must name the operator decision.
    const blank = settleCmd(340, 'FAILED_NEEDS_REVIEW', 'SETTLED', ' ');
    expect(errCode(() => decide(s, blank))).toBe('bad_command');
    const resolved = settle(
      s,
      340,
      'FAILED_NEEDS_REVIEW',
      'SETTLED',
      'ops-17 voids released by hand',
    );
    const done = run(resolved, complete(350, B, 1500)).state;
    expect(done.lots[L1]?.status).toBe('DONE');
    expect(done.lots[L1]?.capturedCents).toBe(1500);
    expect(run(done, close(360)).state.closed).toBe(true);
  });

  it('T-ENG-310 R12-E02 a capture mismatch sent to review can retry the release and then complete', () => {
    let s = captured(soldToB(), 310);
    s = settle(s, 320, 'CAPTURED', 'FAILED_NEEDS_REVIEW');
    s = settle(s, 330, 'FAILED_NEEDS_REVIEW', 'VOIDING', 'ops-18 capture checked, retry voids');
    s = settle(s, 340, 'VOIDING', 'SETTLED');
    const done = run(s, complete(350, B, 1500)).state;
    expect(done.lots[L1]?.status).toBe('DONE');
    // The review edges are operator steps only: the saga graph still has no other exit.
    expect(errCode(() => decide(s, settleCmd(345, 'SETTLED', 'VOIDING')))).toBe('state_continuity');
  });

  it('T-ENG-311 R12-E03 a trailing bid stays reserved when its bidder is promoted elsewhere', () => {
    for (const [ceiling, promoted] of [
      [10_000, false],
      [12_000, true],
    ] as const) {
      let s = created({}, [lotConfig(L1), lotConfig(L2)]);
      s = register(s, A, 90_000);
      s = register(s, B, ceiling);
      s = register(s, LEAD, 90_000);
      s = open(s, L1);
      s = bid(s, 200, B, 7000).state;
      s = bid(s, 210, A, 8000).state;
      s = hammer(s, 300);
      s = open(s, L2, 400);
      s = bid(s, 410, B, 4000, L2).state;
      s = bid(s, 420, LEAD, 5000, L2).state;
      const r = run(s, promote(500, A));
      const types = r.entries.map((e) => e.type);
      expect(types).toEqual(promoted ? ['FALLBACK_PROMOTED'] : ['CANDIDATE_SKIPPED', 'LOT_UNSOLD']);
      s = run(
        r.state,
        mk(510, { type: 'RevokeCeiling', bidderId: LEAD, reason: 'declined' }),
      ).state;
      // B now leads lot 2 with 4000, which must still fit B's available ceiling.
      expect(s.lots[L2]?.leaderId).toBe(B);
      expect(available(s, B, L2)).toBeGreaterThanOrEqual(4000);
      const h = hammer(s, 520, L2);
      expect(h.lots[L2]?.winnerId).toBe(B);
      expect(h.lots[L2]?.priceCents).toBe(4000);
    }
  });

  it('T-ENG-311 R12-E03 property: no open bid ever exceeds its bidder ceiling, so the hammer never throws', () => {
    const op = fc.record({
      kind: fc.constantFrom('bid', 'bid', 'bid', 'promote', 'revoke'),
      who: fc.integer({ min: 0, max: 3 }),
      amount: fc.integer({ min: 10, max: 90 }).map((n) => n * 100),
    });
    const ceilings = fc.array(
      fc.integer({ min: 20, max: 120 }).map((n) => n * 100),
      {
        minLength: 4,
        maxLength: 4,
      },
    );
    const who = [A, B, C, LEAD];
    fc.assert(
      fc.property(ceilings, fc.array(op, { maxLength: 30 }), (ceil, ops) => {
        let s = created({ maxFallbackDepth: 3 }, [lotConfig(L1), lotConfig(L2)]);
        who.forEach((b, i) => {
          s = register(s, b, ceil[i] ?? 2000);
        });
        s = open(s, L1);
        who.forEach((b, i) => {
          s = bid(s, 200 + i, b, 1000 + 500 * i).state;
        });
        s = hammer(s, 300);
        s = open(s, L2, 400);
        let at = 400;
        for (const o of ops) {
          at += 1;
          const bidder = who[o.who] as Ulid;
          const winner = s.lots[L1]?.winnerId ?? null;
          const cmd =
            o.kind === 'bid'
              ? mk(at, {
                  type: 'PlaceBid',
                  lotId: L2,
                  bidderId: bidder,
                  amountCents: o.amount,
                  source: 'manual',
                  audit: {},
                })
              : o.kind === 'promote' && winner !== null
                ? promote(at, winner)
                : mk(at, { type: 'RevokeCeiling', bidderId: bidder, reason: 'declined' });
          try {
            s = run(s, cmd).state;
          } catch (e) {
            if (e instanceof InvariantError) throw e;
          }
          for (const [b, rec] of Object.entries(s.lots[L2]?.best ?? {})) {
            expect(rec.amountCents).toBeLessThanOrEqual(available(s, b, L2));
          }
        }
        expect(() => hammer(s, at + 1, L2)).not.toThrow();
      }),
      { seed: SEED, numRuns: runsFor('round12-engine', 200) },
    );
  });

  it('T-ENG-312 R12-E04 a lot with no winner records the release of its holds but never a capture', () => {
    let aborted = open(scene(), L1);
    aborted = run(
      aborted,
      mk(200, { type: 'AbortLot', lotId: L1, reason: 'kill', actor: 'ops' }),
    ).state;
    // The saga passes WINNER_SELECTED after the hammer even when nobody is charged.
    let s = settle(aborted, 210, 'HELD', 'BIDDING');
    s = settle(s, 215, 'BIDDING', 'WINNER_SELECTED');
    expect(errCode(() => decide(s, settleCmd(220, 'WINNER_SELECTED', 'CAPTURING')))).toBe(
      'state_continuity',
    );
    s = settle(s, 220, 'WINNER_SELECTED', 'VOIDING');
    s = settle(s, 230, 'VOIDING', 'SETTLED');
    expect(s.lots[L1]?.captureSeen).toBe(false);

    // An unsold lot after CloseAuction: the release is still recorded, a capture never is.
    let u = hammer(open(scene(), L1), 200);
    expect(u.lots[L1]?.status).toBe('DONE');
    u = run(u, close(210)).state;
    u = settle(u, 220, 'HELD', 'BIDDING');
    u = settle(u, 225, 'BIDDING', 'WINNER_SELECTED');
    expect(errCode(() => decide(u, settleCmd(230, 'WINNER_SELECTED', 'CAPTURING')))).toBe(
      'state_continuity',
    );
    u = settle(u, 230, 'WINNER_SELECTED', 'VOIDING');
    u = settle(u, 240, 'VOIDING', 'SETTLED');
    expect(u.lots[L1]?.settlement).toBe('SETTLED');
    expect(u.lots[L1]?.captureSeen).toBe(false);
  });

  it('T-ENG-313 R12-E10 after a recorded capture a promotion can never end the lot unsold', () => {
    let s = captured(soldToB(), 310);
    s = settle(s, 320, 'CAPTURED', 'VOIDING');
    s = settle(s, 330, 'VOIDING', 'SETTLED');
    expect(s.lots[L1]?.captureSeen).toBe(true);
    // The only runner-up is revoked, so the promotion would end the lot unsold.
    const revoked = run(s, mk(340, { type: 'RevokeCeiling', bidderId: A, reason: 'declined' }));
    expect(errCode(() => decide(revoked.state, promote(350, B)))).toBe('state_continuity');
    expect(revoked.state.lots[L1]?.winnerId).toBe(B);
    // Policy unsold is refused the same way.
    let p = captured(soldToB({ fallbackPolicy: 'unsold' }), 310);
    p = settle(p, 320, 'CAPTURED', 'VOIDING');
    p = settle(p, 330, 'VOIDING', 'SETTLED');
    expect(errCode(() => decide(p, promote(350, B)))).toBe('state_continuity');
    // Moving the lot to the bidder the saga charged still works.
    const moved = run(s, promote(350, B));
    expect(moved.entries.map((e) => e.type)).toEqual(['FALLBACK_PROMOTED']);
    expect(moved.state.lots[L1]?.winnerId).toBe(A);
  });

  it('T-ENG-314 R12-E12 a RecordSettlement ref may not use the promotion prefix', () => {
    let s = soldToB();
    s = settle(s, 310, 'HELD', 'BIDDING');
    const forged = settleCmd(320, 'BIDDING', 'WINNER_SELECTED', 'promote:retry-1');
    expect(errCode(() => decide(s, forged))).toBe('bad_command');
    expect(errCode(() => parseCommand({ ...forged }))).toBe('bad_command');
    // A normal ref retried after a lost ack is a duplicate, never a conflict.
    const key = id('RS1');
    const step = mk(
      320,
      {
        type: 'RecordSettlement',
        lotId: L1,
        from: 'BIDDING',
        to: 'WINNER_SELECTED',
        ref: 'saga-2',
      },
      key,
    );
    const next = run(s, step).state;
    expect(decide(next, { ...step, at: 330 }).outcome.kind).toBe('duplicate');
  });
});

describe('review round 12: time, scope and history', () => {
  const hardLot = lotConfig(L1, {
    durationMs: 100_000,
    softClose: { windowMs: 30_000, extensionMs: 30_000, maxExtensions: 50, hardCloseMs: 120_000 },
  });
  const extend = (at: number, extraMs: number) =>
    mk(at, { type: 'ExtendLot', lotId: L1, extraMs, reason: 'tech', actor: 'host' });

  it('T-ENG-315 R12-E08 R-ENG-036 ExtendLot stops at the hard close and checks extraMs itself', () => {
    let s = open(scene({ lots: [hardLot] }), L1, 0);
    expect(hardCloseOf(s.lots[L1] as LotState)).toBe(120_000);
    for (const extraMs of [0, -5, 1.5, 600_001]) {
      expect(errCode(() => decide(s, extend(50_000, extraMs)))).toBe('bad_command');
    }
    expect(errCode(() => decide(s, extend(90_000, 600_000)))).toBe('bad_command');
    s = run(s, extend(90_000, 20_000)).state;
    expect(s.lots[L1]?.endsAt).toBe(120_000);
    expect(errCode(() => decide(s, extend(90_001, 1)))).toBe('bad_command');
  });

  it('T-ENG-315 R12-E08 R-ENG-036 a pause moves the hard close by exactly the paused time', () => {
    let s = open(scene({ lots: [hardLot] }), L1, 0);
    s = run(s, mk(50_000, { type: 'PauseLot', lotId: L1, actor: 'host' })).state;
    const r = run(s, mk(3_650_000, { type: 'ResumeLot', lotId: L1, actor: 'host' }));
    s = r.state;
    const resumed = r.entries[0]?.payload as { endsAtBefore: number; endsAtAfter: number };
    const paused = resumed.endsAtAfter - resumed.endsAtBefore;
    expect(paused).toBe(3_600_000);
    const lot = s.lots[L1];
    expect(lot?.endsAt).toBe(3_700_000);
    expect(hardCloseOf(lot as LotState)).toBe(120_000 + paused);
    expect(errCode(() => decide(s, extend(3_650_001, 20_001)))).toBe('bad_command');
    // A late bid may extend up to the moved hard close, not past it.
    const late = bid(s, 3_690_000, A, 1000);
    expect(late.entries.map((e) => e.type)).toEqual(['BID_RECORDED', 'END_EXTENDED']);
    s = late.state;
    expect(s.lots[L1]?.endsAt).toBe(3_720_000);
    expect(errCode(() => decide(s, extend(3_690_001, 1)))).toBe('bad_command');
  });

  it('T-ENG-316 R12-E09 R-ENG-044 under holdScope lot the end of one hold leaves the other lots alone', () => {
    let s = created({ holdScope: 'lot' }, [lotConfig(L1), lotConfig(L2), lotConfig(L3)]);
    s = register(s, P, 5000, { lotId: L1, holdRef: 'H1' });
    s = register(s, P, 5000, { lotId: L2, holdRef: 'H2' });
    s = register(s, Q, 5000, { lotId: L1, holdRef: 'HQ' });
    s = open(s, L1);
    s = bid(s, 200, Q, 2000).state;
    s = hammer(s, 300);
    s = open(s, L2, 400);
    s = bid(s, 410, P, 2000, L2).state;
    // Lot 1 settled without P: the saga voids H1.
    const voided = run(
      s,
      mk(500, { type: 'RevokeCeiling', bidderId: P, holdRef: 'H1', reason: 'voided' }),
    );
    expect(voided.entries.map((e) => e.type)).toEqual(['CEILING_REVOKED']);
    expect(voided.entries[0]?.payload).toMatchObject({ bidderId: P, lotId: L1, holdRef: 'H1' });
    s = voided.state;
    expect(s.lots[L2]?.leaderId).toBe(P);
    expect(available(s, P, L2)).toBe(5000);
    expect(bid(s, 510, P, 2500, L2).result.outcome).toEqual({
      kind: 'rejected',
      reason: 'already_leading',
    });
    expect(
      decide(s, mk(520, { type: 'RevokeCeiling', bidderId: P, holdRef: 'H1', reason: 'voided' }))
        .outcome.kind,
    ).toBe('noop');
    // P may still register for another lot: H1 ending was not a verdict on P.
    expect(register(s, P, 5000, { lotId: L3, holdRef: 'H3' }).bidders[`${P}@${L3}`]?.revoked).toBe(
      false,
    );
    // The hold that backs lot 2 strikes lot 2 only.
    const declined = run(
      s,
      mk(530, { type: 'RevokeCeiling', bidderId: P, holdRef: 'H2', reason: 'declined' }),
    );
    expect(declined.entries.map((e) => e.type)).toEqual(['CEILING_REVOKED', 'BID_STRUCK']);
    expect(declined.entries[0]?.payload).toMatchObject({ lotId: L2 });
    // A revocation without a holdRef still covers the bidder everywhere and blocks new lots.
    const all = run(s, mk(540, { type: 'RevokeCeiling', bidderId: P, reason: 'other' }));
    expect(all.entries[0]?.payload).not.toHaveProperty('lotId');
    expect(
      Object.values(all.state.bidders)
        .filter((b) => b.bidderId === P)
        .every((b) => b.revoked),
    ).toBe(true);
    const again = mk(550, { type: 'RegisterBidder', bidderId: P, ceilingCents: 5000, lotId: L3 });
    expect(errCode(() => decide(all.state, again))).toBe('bad_command');
  });

  it('T-ENG-317 R12-E11 R-ENG-048 closedAtSeq names the lot LOT_CLOSING even when entries follow it', () => {
    let s = open(scene(), L1);
    s = bid(s, 200, A, 1000).state;
    s = bid(s, 210, B, 1500).state;
    const tick = run(s, mk(10_100, { type: 'Tick' }));
    const closing = tick.entries[0];
    expect(closing?.type).toBe('LOT_CLOSING');
    s = run(
      tick.state,
      mk(10_200, { type: 'RevokeCeiling', bidderId: B, reason: 'declined' }),
    ).state;
    expect(s.head.seq).toBeGreaterThan(closing?.seq ?? 0);
    const h = run(s, mk(10_300, { type: 'Hammer', lotId: L1, actor: 'host' }));
    expect(h.entries[0]?.payload).toMatchObject({ winnerId: A, closedAtSeq: closing?.seq });
    expect(h.state.lots[L1]).not.toHaveProperty('closingSeq');
    // An early hammer names the closing entry of its own batch.
    let e = open(scene(), L1);
    e = bid(e, 200, A, 1000).state;
    const early = run(e, mk(300, { type: 'Hammer', lotId: L1, actor: 'host', early: true }));
    expect(early.entries[1]?.payload).toMatchObject({ closedAtSeq: early.entries[0]?.seq });
  });

  it('T-ENG-318 R12-E13 AUCTION_CREATED stores the whole config and old partial ledgers keep their meaning', () => {
    const r = run(
      initialState,
      mk(0, { type: 'CreateAuction', title: 'Gala', config: { holdScope: 'lot' } }),
    );
    expect(r.entries[0]?.payload).toEqual({
      title: 'Gala',
      config: { ...DEFAULT_AUCTION_CONFIG, holdScope: 'lot' },
    });
    // An older ledger stored only what the caller passed.
    const createId = id('CR8D');
    const old = entriesFrom(
      [
        {
          event: {
            type: 'AUCTION_CREATED',
            payload: { title: 'Gala', config: { currency: 'USD', holdScope: 'event' } },
          } as LedgerEvent,
          at: 0,
          cmd: createId,
        },
      ],
      AU,
    );
    const defaults = DEFAULT_AUCTION_CONFIG as {
      maxFallbackDepth: number;
      confirmBelowBps: number;
    };
    const saved = { ...defaults };
    try {
      // A later release changes the code defaults; the old ledger must not change meaning.
      defaults.maxFallbackDepth = 3;
      defaults.confirmBelowBps = 9000;
      const replayed = evolveAll(old);
      expect(replayed.config).toEqual(LEDGER_V1_AUCTION_DEFAULTS);
      expect(replayed.config.maxFallbackDepth).toBe(2);
      expect(replayed.config.confirmBelowBps).toBe(8500);
    } finally {
      Object.assign(defaults, saved);
    }
    // A retry of the original command still dedupes against the partial entry. The retry names the
    // cap the old ledger meant, because the code default for a new auction is now higher.
    const retry = mk(
      5,
      {
        type: 'CreateAuction',
        title: 'Gala',
        config: { currency: 'USD', holdScope: 'event', maxCeilingCents: 100000 },
      },
      createId,
    );
    expect(decide(evolveAll(old), retry).outcome.kind).toBe('duplicate');
  });
});
