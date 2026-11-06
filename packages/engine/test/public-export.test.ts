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
const lot = (mode: 'english' | 'proxy' | 'second_price'): LedgerEvent => ({
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
const audit: Record<string, unknown> = {};
const recorded = (amountCents: number, a: Record<string, unknown> = audit): LedgerEvent =>
  ({
    type: 'BID_RECORDED',
    payload: {
      bidId: `b${amountCents}`,
      lotId: L,
      bidderId: P,
      amountCents,
      source: 'ui',
      audit: a,
      priceBefore: 1000,
      priceAfter: amountCents,
      leaderBefore: Q,
      leaderAfter: P,
      rank: 1,
      endsAtBefore: 5,
      endsAtAfter: 5,
    },
  }) as unknown as LedgerEvent;

function ledger(
  mode: 'english' | 'proxy' | 'second_price',
  a: Record<string, unknown> = audit,
): LedgerEntry[] {
  const events: LedgerEvent[] = [
    { type: 'AUCTION_CREATED', payload: { title: 'Gala', config: {} } },
    lot(mode),
    {
      type: 'BIDDER_REGISTERED',
      payload: { bidderId: P, ceilingCents: 90000, holdRef: 'hold-secret-1' },
    },
    recorded(2000, a),
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
    } as unknown as LedgerEvent,
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
    expect(text).toContain('"other":1');
    const bid = publicExport(ledger('english'))[3] as PublicEntry;
    expect(bid.payload['leaderBefore']).toBeUndefined();
    expect(bid.payload['leaderAfter']).toBeUndefined();
    expect(bid.redacted).toContain('leaderAfter');
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
    expect(verifyPublicExport(pub)).toMatchObject({
      ok: true,
      count: pub.length,
      headHash: (pub[pub.length - 1] as PublicEntry).hash,
    });
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

  it('T-ENG-087 R-ENG-109 R5-E01: a redacted entry publishes no private hash, so amounts cannot be brute forced', () => {
    const full = ledger('second_price');
    const pub = publicExport(full);
    // From the first redacted entry on no entry carries a private hash (R12-E01).
    const first = pub.findIndex((e) => e.redacted.length > 0);
    expect(first).toBe(2);
    for (const [i, e] of pub.entries()) {
      if (i >= first) expect(e.fullHash).toBeNull();
      else expect(e.fullHash).toBe((full[i] as LedgerEntry).hash);
    }
    const text = JSON.stringify(pub);
    for (const e of full.slice(first)) expect(text).not.toContain(e.hash);
    // The attacker rebuilds the private entry for each small amount and compares the hash.
    const target = full[3] as LedgerEntry;
    const hits = [1999, 2000, 2001].filter((amount) => {
      const guess = sealBatch(
        [{ ...recorded(amount) } as LedgerEvent],
        { auctionId: A, seq: 3, hash: (full[2] as LedgerEntry).hash },
        target.at,
        null,
      )[0] as LedgerEntry;
      return text.includes(guess.hash);
    });
    expect(hits).toEqual([]);
  });

  it('T-ENG-087 R-ENG-108 R5-E01: with a commit key the link is a keyed commitment the auditor can check', () => {
    const full = ledger('second_price');
    const key = 'auditor-secret-01';
    const pub = publicExport(full, undefined, { commitKey: key });
    const bid = pub[3] as PublicEntry;
    expect(bid.fullHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bid.fullHash).not.toBe((full[3] as LedgerEntry).hash);
    expect(verifyPublicExport(pub).ok).toBe(true);
    expect(matchesLedger(pub, full, undefined, { commitKey: key })).toBe(true);
    expect(matchesLedger(pub, full, undefined, { commitKey: 'other' })).toBe(false);
    expect(matchesLedger(pub, full)).toBe(false);
  });

  it('T-ENG-087 R-ENG-109 R5-E02 R12-E05: the spoken transcript is removed on every lot', () => {
    const spoken = { transcript: 'two hundred fifty', utteranceId: 'u1' };
    const bid = publicExport(ledger('second_price', spoken))[3] as PublicEntry;
    expect(JSON.stringify(bid)).not.toContain('two hundred fifty');
    expect(bid.payload['audit']).toEqual({ utteranceId: 'u1' });
    expect(bid.redacted).toContain('audit.transcript');
    const open = publicExport(ledger('english', spoken))[3] as PublicEntry;
    expect(JSON.stringify(open)).not.toContain('two hundred fifty');
    expect(open.redacted).toContain('audit.transcript');
  });

  it('T-ENG-087 R-ENG-019 R-ENG-109 R5-E03: a proxy lot publishes the price but not the bid maximum', () => {
    const spoken = { transcript: 'two thousand' };
    const bid = publicExport(ledger('proxy', spoken))[3] as PublicEntry;
    expect(bid.payload['amountCents']).toBeUndefined();
    expect(bid.payload['amountRaw']).toBeUndefined();
    expect(bid.payload['priceAfter']).toBe(2000);
    expect(bid.redacted).toEqual(expect.arrayContaining(['amountCents', 'audit.transcript']));
    expect(JSON.stringify(bid)).not.toContain('two thousand');
  });

  it('T-ENG-087 R-ENG-078 R5-E05: matchesLedger rejects a public entry whose content changed but whose hashes did not', () => {
    const full = ledger('english');
    const pub = JSON.parse(JSON.stringify(publicExport(full))) as PublicEntry[];
    expect(matchesLedger(pub, full)).toBe(true);
    (pub[3] as PublicEntry).payload['bidId'] = 'forged';
    expect(matchesLedger(pub, full)).toBe(false);
    const badLedger = JSON.parse(JSON.stringify(full)) as LedgerEntry[];
    (badLedger[1] as { at: number }).at += 1;
    expect(matchesLedger(publicExport(badLedger), badLedger)).toBe(false);
  });

  it('T-ENG-058 R-ENG-078 R5-E06: a truncated public export fails against the expected head', () => {
    const pub = publicExport(ledger('english'));
    const head = pub[pub.length - 1] as PublicEntry;
    const expectedHead = { seq: head.seq, hash: head.hash };
    expect(verifyPublicExport(pub, undefined, { expectedHead }).ok).toBe(true);
    expect(verifyPublicExport(pub.slice(0, 3), undefined, { expectedHead })).toMatchObject({
      ok: false,
      reason: 'truncated',
    });
    expect(verifyPublicExport([], undefined, { expectedHead })).toMatchObject({
      reason: 'truncated',
    });
  });
});
