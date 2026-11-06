import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands.js';
import { decide } from '../src/decide/index.js';
import { evolve, evolveOwned } from '../src/evolve.js';
import type { LedgerEntry } from '../src/events.js';
import { sealBatch, verifyChain } from '../src/ledger/chain.js';
import { exportJsonl, verifyJsonl } from '../src/ledger/export.js';
import { publicExport, verifyPublicExport } from '../src/ledger/public-export.js';
import { initialState } from '../src/state.js';
import type { AuctionState } from '../src/state.js';
import {
  A,
  AU,
  B,
  C,
  L1,
  bid,
  mk,
  open,
  run,
  scene,
  lotConfig,
} from './decide-helpers.js';

function recorder(): { apply: (cmd: Command) => void; entries: LedgerEntry[] } {
  let s = initialState;
  const entries: LedgerEntry[] = [];
  return {
    apply(cmd) {
      const r = decide(s, cmd);
      const head = { auctionId: AU, seq: s.head.seq, hash: s.head.hash };
      const sealed = sealBatch(r.events, head, cmd.at, cmd.commandId);
      s = sealed.reduce(evolve, s);
      entries.push(...sealed);
    },
    entries,
  };
}

/** A finished auction: one sold lot, settled, then closed. */
function closedLedger(): LedgerEntry[] {
  const r = recorder();
  r.apply(mk(1, { type: 'CreateAuction', title: 'Gala', config: {} }));
  r.apply(mk(2, { type: 'AddLot', lot: lotConfig(L1) }));
  r.apply(mk(3, { type: 'RegisterBidder', bidderId: A, ceilingCents: 50_000 }));
  r.apply(mk(4, { type: 'OpenLot', lotId: L1 }));
  r.apply(
    mk(10, {
      type: 'PlaceBid',
      lotId: L1,
      bidderId: A,
      amountCents: 2000,
      source: 'manual',
      audit: {},
    }),
  );
  r.apply(mk(20, { type: 'Hammer', lotId: L1, actor: 'host', early: true }));
  const path = ['HELD', 'BIDDING', 'WINNER_SELECTED', 'CAPTURING', 'CAPTURED'] as const;
  for (let i = 1; i < path.length; i += 1) {
    r.apply(
      mk(21, {
        type: 'RecordSettlement',
        lotId: L1,
        from: path[i - 1] as (typeof path)[number],
        to: path[i] as (typeof path)[number],
        ref: `s${i}`,
      }),
    );
  }
  r.apply(mk(22, { type: 'CompleteLot', lotId: L1, bidderId: A, capturedCents: 2000, ref: 'c' }));
  r.apply(mk(30, { type: 'CloseAuction' }));
  return r.entries;
}

describe('HRD-55 closed ledger anchor (#1753)', () => {
  it('T-ENG-161 R-ENG-064 a full ledger is closed and a cut tail is not, in the chain, jsonl and public verifiers', () => {
    const entries = closedLedger();
    expect(entries.at(-1)?.type).toBe('AUCTION_CLOSED');
    expect(verifyChain(entries)).toMatchObject({ ok: true, closed: true });
    expect(verifyJsonl(exportJsonl(entries))).toMatchObject({ ok: true, closed: true });
    const pub = publicExport(entries);
    expect(verifyPublicExport(pub)).toMatchObject({ ok: true, closed: true });
    for (const cut of [1, 2, 3]) {
      const head = entries.slice(0, entries.length - cut);
      expect(verifyChain(head)).toMatchObject({ ok: true, closed: false });
      expect(verifyJsonl(exportJsonl(head))).toMatchObject({ ok: true, closed: false });
      expect(verifyPublicExport(publicExport(head))).toMatchObject({ ok: true, closed: false });
    }
  });
});

describe('HRD-55 public export hides the private head hash (#1754)', () => {
  it('T-ENG-162 R-ENG-064 AUCTION_CLOSED names the previous public hash and no private hash is published', () => {
    const entries = closedLedger();
    const pub = publicExport(entries);
    const last = pub[pub.length - 1];
    const before = pub[pub.length - 2];
    expect(last?.redacted).toContain('headHash');
    expect(last?.payload['headHash']).toBe(before?.hash);
    const text = JSON.stringify(pub);
    for (const e of entries.slice(pub.findIndex((p) => p.redacted.length > 0))) {
      expect(text.includes(e.hash)).toBe(false);
    }
  });
});

describe('HRD-55 promotion in a state that cannot charge ends unsold (#1755)', () => {
  const hammered = (): AuctionState => {
    let s = open(scene(), L1);
    s = bid(s, 200, A, 1000).state;
    s = bid(s, 210, B, 1500).state;
    s = bid(s, 220, C, 2000).state;
    return run(s, mk(300, { type: 'Hammer', lotId: L1, actor: 'host', early: true })).state;
  };
  const settle = (s: AuctionState, at: number, from: string, to: string): AuctionState =>
    run(
      s,
      mk(at, {
        type: 'RecordSettlement',
        lotId: L1,
        from: from as never,
        to: to as never,
        ref: 'r',
      }),
    ).state;
  const promote = (at: number) =>
    mk(at, { type: 'PromoteRunnerUp', lotId: L1, disqualifiedBidderId: C, reason: 'hold_failed' });

  it('T-ENG-163 R-ENG-054 ends the lot unsold in VOIDING and FAILED_NEEDS_REVIEW without a capture', () => {
    const voiding = settle(hammered(), 310, 'HELD', 'VOIDING');
    expect(decide(voiding, promote(400)).events.map((e) => e.type)).toEqual(['LOT_UNSOLD']);
    let failed = settle(hammered(), 310, 'HELD', 'BIDDING');
    failed = settle(failed, 311, 'BIDDING', 'WINNER_SELECTED');
    failed = settle(failed, 312, 'WINNER_SELECTED', 'FAILED_NEEDS_REVIEW');
    expect(decide(failed, promote(400)).events.map((e) => e.type)).toEqual(['LOT_UNSOLD']);
  });

  it('T-ENG-164 R-ENG-054 still promotes from HELD and from WINNER_SELECTED', () => {
    const held = decide(hammered(), promote(400));
    expect(held.events.map((e) => e.type)).toEqual(['FALLBACK_PROMOTED']);
    let sel = settle(hammered(), 310, 'HELD', 'BIDDING');
    sel = settle(sel, 311, 'BIDDING', 'WINNER_SELECTED');
    expect(decide(sel, promote(400)).events.map((e) => e.type)).toEqual(['FALLBACK_PROMOTED']);
  });
});

describe('HRD-55 evolveOwned keeps the cost of one entry flat (#1757)', () => {
  const plays = (): LedgerEntry[] => {
    const r = recorder();
    r.apply(mk(1, { type: 'CreateAuction', title: 'Gala', config: {} }));
    r.apply(mk(2, { type: 'AddLot', lot: lotConfig(L1) }));
    r.apply(mk(3, { type: 'RegisterBidder', bidderId: A, ceilingCents: 90_000 }));
    r.apply(mk(4, { type: 'OpenLot', lotId: L1 }));
    for (let i = 0; i < 20; i += 1) {
      r.apply(
        mk(10 + i, {
          type: 'PlaceBid',
          lotId: L1,
          bidderId: A,
          amountCents: 2000 + i * 100,
          source: 'manual',
          audit: {},
        }),
      );
    }
    return r.entries;
  };

  it('T-ENG-165 R-ENG-118 gives the same state as folding evolve', () => {
    const entries = plays();
    let owned = initialState;
    for (const e of entries) owned = evolveOwned(owned, [e]);
    expect(owned).toEqual(entries.reduce(evolve, initialState));
    expect(initialState.commands).toEqual({});
  });

  it('T-ENG-166 R-ENG-118 extends the seen-command index and the bid list in place after the first call', () => {
    const entries = plays();
    const first = evolveOwned(initialState, entries.slice(0, 10));
    const second = evolveOwned(first, entries.slice(10, 20));
    expect(second.commands).toBe(first.commands);
    expect(second.lots[L1]?.bids).toBe(first.lots[L1]?.bids);
    const plain = entries.slice(0, 10).reduce(evolve, initialState);
    const next = evolve(plain, entries[10] as LedgerEntry);
    expect(next.commands).not.toBe(plain.commands);
  });
});
