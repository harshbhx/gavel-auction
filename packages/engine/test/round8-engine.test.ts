import { describe, expect, it } from 'vitest';
import { genesisHead, sealBatch } from '../src/ledger/chain.js';
import { publicExport } from '../src/ledger/public-export.js';
import type { LedgerEntry, LedgerEvent } from '../src/events.js';
import { decide } from '../src/decide/index.js';
import type { SettlementState } from '../src/events.js';
import { LIMITS } from '../src/types.js';
import type { AuctionState, LotState } from '../src/state.js';
import {
  A,
  B,
  L1,
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

const step = (s: AuctionState, at: number, from: SettlementState, to: SettlementState) =>
  run(s, mk(at, { type: 'RecordSettlement', lotId: L1, from, to, ref: 'r' })).state;

function hammered(): AuctionState {
  let s = open(scene(), L1);
  s = bid(s, 200, A, 1000).state;
  s = bid(s, 210, B, 1500).state;
  return run(s, mk(300, { type: 'Hammer', lotId: L1, actor: 'host', early: true })).state;
}
const promoteCmd = (at: number, key = id('PRK')) =>
  mk(at, { type: 'PromoteRunnerUp', lotId: L1, disqualifiedBidderId: B, reason: 'declined' }, key);

describe('red team round 8 engine fixes', () => {
  it('T-ENG-149 R8-E01 a promotion after the capture is refused and keeps the winner', () => {
    const s = captured(hammered(), 310);
    expect(s.lots[L1]?.captureSeen).toBe(true);
    expect(errCode(() => decide(s, promoteCmd(400)))).toBe('state_continuity');
    expect(s.lots[L1]?.winnerId).toBe(B);
  });

  it('T-ENG-150 R8-E01 a promotion while releasing is refused, one before the capture still works', () => {
    let s = hammered();
    s = step(s, 310, 'HELD', 'BIDDING');
    s = step(s, 320, 'BIDDING', 'WINNER_SELECTED');
    s = step(s, 330, 'WINNER_SELECTED', 'CAPTURING');
    const r = run(s, promoteCmd(400));
    expect(r.state.lots[L1]?.winnerId).toBe(A);
    expect(r.state.lots[L1]?.captureSeen).toBe(false);
    const v = captured(hammered(), 310);
    const voiding = step(v, 320, 'CAPTURED', 'VOIDING');
    expect(errCode(() => decide(voiding, promoteCmd(400)))).toBe('state_continuity');
  });

  it('T-ENG-151 R8-E02 a promotion that ends unsold from CAPTURING retries as a duplicate', () => {
    let s = open(scene(), L1);
    s = bid(s, 200, A, 1000).state;
    s = run(s, mk(300, { type: 'Hammer', lotId: L1, actor: 'host', early: true })).state;
    s = step(s, 310, 'HELD', 'BIDDING');
    s = step(s, 320, 'BIDDING', 'WINNER_SELECTED');
    s = step(s, 330, 'WINNER_SELECTED', 'CAPTURING');
    const key = id('PRK2');
    const cmd = (who: typeof A, at: number) =>
      mk(
        at,
        { type: 'PromoteRunnerUp', lotId: L1, disqualifiedBidderId: who, reason: 'declined' },
        key,
      );
    const first = run(s, cmd(A, 400));
    expect(first.entries.map((e) => e.type)).toEqual(['SETTLEMENT_STATE', 'LOT_UNSOLD']);
    expect(decide(first.state, cmd(A, 410)).outcome.kind).toBe('duplicate');
    expect(errCode(() => decide(first.state, cmd(B, 420)))).toBe('command_conflict');
  });

  it('T-ENG-152 R8-E04 a raise on a revoked bidder is refused in both scopes', () => {
    for (const lotId of [undefined, L1]) {
      const scope = lotId === undefined ? {} : { lotId };
      let s = scene({ config: { holdScope: lotId === undefined ? 'event' : 'lot' } });
      s = run(
        s,
        mk(1, {
          type: 'RegisterBidder',
          bidderId: id('BZ'),
          ceilingCents: 1000,
          holdRef: 'H1',
          ...scope,
        }),
      ).state;
      s = run(s, mk(2, { type: 'RevokeCeiling', bidderId: id('BZ'), reason: 'declined' })).state;
      const raise = mk(3, {
        type: 'RegisterBidder',
        bidderId: id('BZ'),
        ceilingCents: 2000,
        holdRef: 'H2',
        ...scope,
      });
      expect(errCode(() => decide(s, raise))).toBe('bad_command');
    }
  });

  it('T-ENG-153 R8-E03 the public hammer entry of a proxy lot drops the ranking maxima', () => {
    const lotId = id('M9');
    const events = [
      { type: 'AUCTION_CREATED', payload: { title: 'Gala', config: {} } },
      {
        type: 'LOT_ADDED',
        payload: {
          lotId,
          lot: {
            lotId,
            title: 'Vase',
            mode: 'proxy',
            reserveCents: 1000,
            increment: { flatCents: 100 },
            durationMs: 1000,
            softClose: { windowMs: 0, extensionMs: 0, maxExtensions: 0 },
            hammer: 'auto',
          },
        },
      },
      {
        type: 'LOT_HAMMERED',
        payload: {
          lotId,
          winnerId: A,
          priceCents: 1100,
          mode: 'proxy',
          ranking: [
            { bidderId: A, amountCents: 77777, at: 5, seq: 3 },
            { bidderId: B, amountCents: 1000, at: 4, seq: 2 },
          ],
          candidates: [{ bidderId: B, priceCents: 1000 }],
          closedAtSeq: 3,
          actor: 'host',
        },
      },
    ] as unknown as LedgerEvent[];
    const full: LedgerEntry[] = [];
    for (const ev of events) {
      const head =
        full.length === 0
          ? genesisHead(id('AAA'))
          : {
              auctionId: id('AAA'),
              seq: full.length,
              hash: (full[full.length - 1] as LedgerEntry).hash,
            };
      full.push(...sealBatch([ev], head, 100 + full.length, null));
    }
    const hammer = publicExport(full)[2];
    expect(JSON.stringify(hammer)).not.toContain('77777');
    expect(hammer?.payload['priceCents']).toBe(1100);
    expect(hammer?.redacted).toContain('ranking.amountCents');
    expect((hammer?.payload['ranking'] as { bidderId: string }[]).map((r) => r.bidderId)).toEqual([
      A,
      B,
    ]);
  });

  describe('R8-E05 bid caps', () => {
    const filler = (n: number, bidderId: string, amountCents: number): LotState['bids'] =>
      Array.from({ length: n }, (_v, i) => ({
        bidId: `f${bidderId}${i}`,
        bidderId,
        amountCents,
        at: 0,
        seq: i,
        status: 'active' as const,
      }));
    const base = (bids: LotState['bids']): AuctionState => {
      const s = open(scene({ lots: [lotConfig(L1, { mode: 'proxy' })] }), L1);
      const lot = s.lots[L1] as LotState;
      return { ...s, lots: { ...s.lots, [L1]: { ...lot, bids } } };
    };
    const place = (who: typeof A, amountCents: number) =>
      mk(200, {
        type: 'PlaceBid',
        lotId: L1,
        bidderId: who,
        amountCents,
        source: 'manual',
        audit: {},
      });

    it('T-ENG-154 one bidder cannot fill the lot', () => {
      const s = base(filler(LIMITS.bidsPerBidderPerLot, A, 1000));
      expect(decide(s, place(A, 1100)).outcome).toEqual({
        kind: 'rejected',
        reason: 'limit_exceeded',
      });
      expect(decide(s, place(B, 1200)).outcome.kind).toBe('accepted');
    });

    it('T-ENG-155 the reserved slots only take a bid that leads', () => {
      const bids = [
        ...Array.from({ length: 17 }, (_v, k) => filler(1000, `F${k}`, 1000)).flat(),
        ...filler(1000, A, 3000),
      ].map((b, i) => ({ ...b, bidId: `x${i}`, seq: i }));
      const s = base(bids);
      expect(s.lots[L1]?.bids.length).toBe(LIMITS.bidsPerLot - LIMITS.bidsReservedForLead);
      expect(decide(s, place(A, 3100)).outcome.kind).toBe('rejected');
      expect(decide(s, place(B, 5000)).outcome.kind).toBe('accepted');
    });
  });
});
