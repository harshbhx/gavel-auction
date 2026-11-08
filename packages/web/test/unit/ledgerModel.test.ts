import { describe, expect, it } from 'vitest';
import { totalsAddUp, holdRowsFromSim, holdTotals } from '../../src/grid/holdsModel';
import {
  GENESIS_PREV,
  chainCounts,
  entriesFromAudit,
  firstBad,
  hashInput,
  sealChain,
  shortHash,
  verifyEntries,
  type LedgerEntry,
} from '../../src/grid/ledgerModel';
import { holdsFromBodies, simulateBodies, simulateLedger } from '../../src/grid/simLedger';
import { nodeHash } from '../support/gridTest';

const bodies = [
  { at: 1000, type: 'auction_opened', actor: 'auctioneer', amountCents: null, note: null },
  { at: 2000, type: 'bid_accepted', actor: 'paddle:3', amountCents: 5000, note: null },
  { at: 3000, type: 'hammer', actor: 'auctioneer', amountCents: 5000, note: null },
];

describe('ledger chain', () => {
  it('seals entries into a chain that starts at the genesis hash', async () => {
    const chain = await sealChain(bodies, nodeHash);
    expect(chain.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(chain[0]?.prev).toBe(GENESIS_PREV);
    expect(chain[1]?.prev).toBe(chain[0]?.hash);
    expect(chain[2]?.prev).toBe(chain[1]?.hash);
    expect(chain[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies an intact chain', async () => {
    const chain = await sealChain(bodies, nodeHash);
    const result = await verifyEntries(chain, nodeHash);
    expect([...result.values()]).toEqual(['verified', 'verified', 'verified']);
    expect(firstBad(result)).toBeNull();
  });

  it('marks an edited entry as tampered and leaves the others verified', async () => {
    const chain = await sealChain(bodies, nodeHash);
    const edited = chain.map((e) => (e.seq === 2 ? { ...e, amountCents: 999_999 } : e));
    const result = await verifyEntries(edited, nodeHash);
    expect(result.get(1)).toBe('verified');
    expect(result.get(2)).toBe('tampered');
    expect(result.get(3)).toBe('verified');
    expect(firstBad(result)).toBe(2);
    expect(chainCounts(result)).toEqual({ verified: 2, tampered: 1, broken: 0, unsealed: 0 });
  });

  it('marks an entry whose link does not match the one before as broken', async () => {
    const chain = await sealChain(bodies, nodeHash);
    const dropped = [chain[0], chain[2]] as LedgerEntry[];
    const result = await verifyEntries(dropped, nodeHash);
    expect(result.get(3)).toBe('broken');
  });

  it('does not hash rows that were never sealed', async () => {
    const rows = entriesFromAudit(
      [
        {
          bidId: 'b1',
          bidderId: 'p1',
          source: 'manual',
          outcome: 'rejected',
          reason: 'below_increment',
          serverTs: 5000,
          seq: 7,
          parsedAmount: 1200,
        } as never,
      ],
      () => 4,
    );
    expect(rows[0]).toMatchObject({
      seq: 7,
      type: 'audit_rejected',
      actor: 'paddle:4',
      amountCents: 1200,
      note: 'below_increment',
      hash: null,
    });
    const result = await verifyEntries(rows, nodeHash);
    expect(result.get(7)).toBe('unsealed');
  });

  it('hashes the body only, never the hash field', async () => {
    const chain = await sealChain(bodies, nodeHash);
    const e = chain[1] as LedgerEntry;
    expect(hashInput(e)).not.toContain(e.hash ?? 'x');
    expect(shortHash(e.hash, 10)).toHaveLength(10);
    expect(shortHash(null)).toBe('');
  });
});

describe('30-day simulated run', () => {
  it('is deterministic and holds thousands of entries', async () => {
    const a = simulateBodies({ days: 30 });
    const b = simulateBodies({ days: 30 });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(1500);
    expect(a.length).toBeLessThan(6000);
    const chain = await simulateLedger(nodeHash, { days: 30 });
    expect(chain).toHaveLength(a.length);
    expect(chain[chain.length - 1]?.seq).toBe(a.length);
  });

  it('settles every simulated hold, and the totals add up', () => {
    const holds = holdRowsFromSim(holdsFromBodies(simulateBodies({ days: 30 })));
    expect(holds.length).toBeGreaterThan(100);
    expect(totalsAddUp(holds)).toBe(true);
    const sum = holdTotals(holds);
    expect(sum.count).toBe(holds.length);
    expect(sum.capturedCents + sum.releasedCents).toBe(sum.heldCents);
    expect(holds.filter((h) => h.state === 'CAPTURED')).toHaveLength(30);
  });

  it('flags totals that do not add up', () => {
    expect(
      totalsAddUp([
        {
          id: 'x',
          ref: 'x',
          paddle: 1,
          state: 'SETTLED',
          heldCents: 100,
          capturedCents: 0,
          releasedCents: 50,
        },
      ]),
    ).toBe(false);
  });
});
