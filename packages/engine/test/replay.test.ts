import { describe, expect, it } from 'vitest';
import { evolve } from '../src/evolve.js';
import type { LedgerEntry, LedgerEvent } from '../src/events.js';
import { genesisHead, sealBatch } from '../src/ledger/chain.js';
import { ChainError, replay, stateDigest } from '../src/replay.js';
import { initialState } from '../src/state.js';
import type { AuctionState } from '../src/state.js';
import type { Ulid } from '../src/types.js';

const AU = '0000000000000000000000AUC1' as Ulid;
const L1 = '000000000000000000000000L1' as Ulid;
const A = '0000000000000000000000000A' as Ulid;

const events: LedgerEvent[] = [
  { type: 'AUCTION_CREATED', payload: { title: 'Gala', config: {} } },
  { type: 'LOT_ADDED', payload: { lotId: L1 } },
  { type: 'BIDDER_REGISTERED', payload: { bidderId: A, ceilingCents: 5000, holdRef: 'AUTH-1' } },
  { type: 'LOT_OPENED', payload: { lotId: L1, endsAt: 9000 } },
  { type: 'LOT_CLOSING', payload: { lotId: L1, reason: 'early' } },
  { type: 'LOT_UNSOLD', payload: { lotId: L1, reason: 'no_bids' } },
];

function ledger(): LedgerEntry[] {
  let head = genesisHead(AU);
  const out: LedgerEntry[] = [];
  events.forEach((ev, i) => {
    const [e] = sealBatch([ev], head, 1000 + i, null);
    if (e === undefined) throw new Error('no entry');
    out.push(e);
    head = { auctionId: AU, seq: e.seq, hash: e.hash };
  });
  return out;
}

describe('replay', () => {
  it('T-ENG-065 R-ENG-093: live and replayed digests agree at every prefix', () => {
    const entries = ledger();
    let live: AuctionState = initialState;
    entries.forEach((e, i) => {
      live = evolve(live, e);
      expect(stateDigest(live)).toBe(stateDigest(replay(entries.slice(0, i + 1))));
    });
    expect(stateDigest(live)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('R-ENG-093: different states give different digests', () => {
    const entries = ledger();
    expect(stateDigest(replay(entries.slice(0, 2)))).not.toBe(stateDigest(replay(entries)));
  });

  it('T-ENG-066 R-ENG-094: a tampered ledger throws ChainError and returns no state', () => {
    const entries = ledger();
    const tampered = entries.map((e, i) =>
      i === 2 ? ({ ...e, payload: { bidderId: A, ceilingCents: 99999 } } as LedgerEntry) : e,
    );
    let got: AuctionState | undefined;
    try {
      got = replay(tampered);
    } catch (e) {
      expect(e).toBeInstanceOf(ChainError);
      expect((e as ChainError).firstBadIndex).toBe(2);
      expect((e as ChainError).reason).toBe('bad_hash');
    }
    expect(got).toBeUndefined();
  });
});
