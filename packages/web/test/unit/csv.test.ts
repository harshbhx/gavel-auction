import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../../src/util/hash';
import { toCsv } from '../../src/util/csv';
import { applyFilters, filtersToSearch, parseFilters } from '../../src/screens/audit/filters';
import { buildExport } from '../../src/screens/audit/Export';
import type { AuditPayload } from '../../src/wire';

describe('toCsv (T-WEB-005)', () => {
  it('escapes commas, quotes and newlines per RFC 4180', () => {
    expect(toCsv([['a,b', 'say "hi"', 'x\ny', 1, null]])).toBe('"a,b","say ""hi""","x\ny",1,');
  });

  it('prefixes formula starters with a single quote', () => {
    expect(toCsv([['=1+1', '+2', '-3', '@x', 'ok']])).toBe("'=1+1,'+2,'-3,'@x,ok");
  });

  it('leaves numbers alone', () => {
    expect(toCsv([[-5]])).toBe('-5');
  });
});

describe('hash (T-WEB-006)', () => {
  it('matches a known SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('ignores key order and notices a changed value', () => {
    expect(canonicalJson({ a: 1, b: { d: 2, c: 3 } })).toBe(
      canonicalJson({ b: { c: 3, d: 2 }, a: 1 }),
    );
    expect(canonicalJson({ amount: 100 })).not.toBe(canonicalJson({ amount: 101 }));
  });

  it('returns null when SubtleCrypto is unavailable', async () => {
    expect(await sha256Hex('abc', null)).toBeNull();
  });
});

function row(seq: number, over: Partial<AuditPayload> = {}): AuditPayload {
  return {
    bidId: `b${seq}`,
    bidderId: `p${seq}`,
    source: 'voice',
    outcome: 'accepted',
    serverTs: 1_700_000_000_000 + seq,
    seq,
    parsedAmount: seq * 100,
    transcript: `bid ${seq}`,
    ...over,
  } as unknown as AuditPayload;
}

const paddleOf = (id: string): number | null => (id === 'p1' ? 12 : 7);

describe('audit filters (T-WEB-042)', () => {
  const rows = [row(1), row(2, { outcome: 'rejected' }), row(3, { confidence: 0.4 })];

  it('combines filters with AND', () => {
    const f = parseFilters('paddle=7&result=rejected');
    expect(applyFilters(rows, f, paddleOf).map((r) => r.seq)).toEqual([2]);
  });

  it('filters by confidence and transcript', () => {
    expect(applyFilters(rows, parseFilters('conf=50'), paddleOf).map((r) => r.seq)).toEqual([3]);
    expect(applyFilters(rows, parseFilters('q=BID 2'), paddleOf).map((r) => r.seq)).toEqual([2]);
  });

  it('round trips through the query string and drops bad values', () => {
    const search = 'paddle=12&result=rejected&source=qr&conf=30&q=hello';
    expect(filtersToSearch(parseFilters(search))).toBe(search);
    expect(filtersToSearch(parseFilters('paddle=x&result=nope&conf=900'))).toBe('');
  });
});

describe('export (T-WEB-043)', () => {
  const rows = [row(1), row(2)];
  const base = { roomId: 'r1', lotId: 'l1', paddleOf, now: 1_700_000_000_000 };

  it('names files and counts rows with a hash header', async () => {
    const json = await buildExport({ ...base, rows, format: 'json' });
    expect(json.name).toBe('gavel-r1-l1-audit.json');
    const parsed = JSON.parse(json.content) as {
      header: { rowCount: number; sha256: string | null };
      rows: unknown[];
    };
    expect(parsed.header.rowCount).toBe(2);
    expect(parsed.header.sha256).toMatch(/^[0-9a-f]{64}$/);
    const csv = await buildExport({ ...base, rows: rows.slice(0, 1), format: 'csv' });
    expect(csv.name).toBe('gavel-r1-l1-audit.csv');
    expect(csv.content.split('\r\n')[0]).toBe('roomId,lotId,exportedAt,rowCount,sha256');
  });

  it('keeps the hash null when hashing is unavailable', async () => {
    const json = await buildExport({ ...base, rows, format: 'json', subtle: null });
    expect((JSON.parse(json.content) as { header: { sha256: null } }).header.sha256).toBeNull();
  });
});
