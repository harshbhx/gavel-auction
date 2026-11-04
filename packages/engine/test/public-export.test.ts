import { describe, expect, it } from 'vitest';
import type { LedgerEntry, LedgerEvent } from '../src/events.js';
import { genesisHead, sealBatch, verifyChain } from '../src/ledger/chain.js';
import { matchesLedger, publicExport, verifyPublicExport } from '../src/ledger/public-export.js';
import type { PublicEntry } from '../src/ledger/public-export.js';
import type { Ulid } from '../src/types.js';

const A = '01JC0000000000000000000001' as Ulid;
const L = '01JC0000000000000000000M01' as Ulid;
const P = '01JC0000000000000000000B01' as Ulid;
const Q = '01JC0000000000000000000B02' as Ulid;
const lot = (mode: 'english' | 'second_price'): LedgerEvent => ({
  type: 'LOT_ADDED',
  payload: {
    lotId: L,
    lot: {
      lotId: L,
      title: 'Vase',
      mode,
      reserveCents: 1000,
      increment: { flatCents: 100 },
      durationMs: 1000,
      softClose: { windowMs: 0, extensionMs: 0, maxExtensions: 0 },
      hammer: 'auto',
    },
  },
});
const audit = {};
const recorded = (amountCents: number): LedgerEvent =>
  ({
    type: 'BID_RECORDED',
    payload: {
      bidId: `b${amountCents}`,
      lotId: L,
      bidderId: P,
      amountCents,
      source: 'ui',
      audit,
      priceBefore: 1000,
      priceAfter: amountCents,
      leaderBefore: Q,
      leaderAfter: P,
      rank: 1,
      endsAtBefore: 5,
      endsAtAfter: 5,
    },
  }) as LedgerEvent;

function ledger(mode: 'english' | 'second_price'): LedgerEntry[] {
  const events: LedgerEvent[] = [
    { type: 'AUCTION_CREATED', payload: { title: 'Gala', config: {} } },
    lot(mode),
    {
      type: 'BIDDER_REGISTERED',
      payload: { bidderId: P, ceilingCents: 90000, holdRef: 'hold-secret-1' },
    },
    recorded(2000),
    {
      type: 'BID_REJECTED',
      payload: {
        bidId: 'r1',
        lotId: L,
        bidderId: Q,
        amountCents: 95000,
        source: 'ui',
        audit,
        reason: 'over_ceiling',
        detail: { availableCeilingCents: 50000, other: 1 },
      },
    } as LedgerEvent,
  ];
  const out: LedgerEntry[] = [];
  for (const ev of events) {
    const head =
      out.length === 0
        ? genesisHead(A)
        : { auctionId: A, seq: out.length, hash: (out[out.length - 1] as LedgerEntry).hash };
    out.push(...sealBatch([ev], head, 100 + out.length, null));
  }
  return out;
}

describe('public export', () => {
  it('T-ENG-087 R-ENG-045 R-ENG-109: ceilings, hold refs and leaders never appear in the export', () => {
    const text = JSON.stringify(publicExport(ledger('english')));
    expect(text).not.toContain('90000');
    expect(text).not.toContain('hold-secret-1');
    expect(text).not.toContain('availableCeilingCents');
    expect(text).not.toContain('leaderAfter');
    expect(text).toContain('"other":1');
  });

  it('T-ENG-087 R-ENG-086: a sealed lot loses amounts before the hammer, an open lot keeps them', () => {
    const sealed = publicExport(ledger('second_price'))[3] as PublicEntry;
    expect(sealed.payload['amountCents']).toBeUndefined();
    expect(sealed.redacted).toContain('amountCents');
    const open = publicExport(ledger('english'))[3] as PublicEntry;
    expect(open.payload['amountCents']).toBe(2000);
  });

  it('T-ENG-087 R-ENG-108: the public chain verifies without the private fields and ties to the ledger', () => {
    const full = ledger('second_price');
    expect(verifyChain(full).ok).toBe(true);
    const pub = publicExport(full);
    expect(verifyPublicExport(pub)).toEqual({
      ok: true,
      count: pub.length,
      headHash: (pub[pub.length - 1] as PublicEntry).hash,
    });
    expect(pub.map((e) => e.fullHash)).toEqual(full.map((e) => e.hash));
    expect(matchesLedger(pub, full)).toBe(true);
    expect(matchesLedger(pub, full.slice(0, 3))).toBe(false);
  });

  it('T-ENG-087 R-ENG-108: tampering with a public entry or its order fails verification', () => {
    const pub = JSON.parse(JSON.stringify(publicExport(ledger('english')))) as PublicEntry[];
    const edited = JSON.parse(JSON.stringify(pub)) as PublicEntry[];
    (edited[3] as PublicEntry).payload['bidId'] = 'x';
    expect(verifyPublicExport(edited)).toMatchObject({
      ok: false,
      firstBadIndex: 3,
      reason: 'bad_hash',
    });
    const swapped = [pub[1], pub[0], ...pub.slice(2)] as PublicEntry[];
    expect(verifyPublicExport(swapped).ok).toBe(false);
    expect(
      verifyPublicExport([{ ...(pub[0] as PublicEntry), v: 1 } as unknown as PublicEntry]),
    ).toMatchObject({ reason: 'bad_version' });
  });

  it('T-ENG-087 R-ENG-072: the private hash chain is unchanged by the export', () => {
    const full = ledger('english');
    const before = JSON.stringify(full);
    publicExport(full);
    expect(JSON.stringify(full)).toBe(before);
  });
});
