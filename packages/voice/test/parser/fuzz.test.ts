import { describe, expect, it } from 'vitest';
import { parseBid } from '../../src/parser/parse.js';
import { parseUtterance } from '../../src/parser/utterance.js';

/** Fixed-seed generator so a failure reproduces exactly. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  'three hundred',
  'two fifty',
  'bidder 4',
  'paddle 12',
  'I bid',
  'and',
  'or',
  'point five k',
  '$1,500',
  '99999999999999999999999',
  '1e308',
  'éèü',
  '日本語',
  '😀🔨',
  '\u0000​‮',
  '...,,,;;;!!!???',
  '-----',
  '   ',
  'no',
  'maybe',
  'who has',
  '0',
  '-5',
  'k',
  'x'.repeat(40),
];

function randomString(rand: () => number): string {
  const parts = Math.floor(rand() * 40);
  let s = '';
  for (let i = 0; i < parts; i += 1) {
    s += PIECES[Math.floor(rand() * PIECES.length)] ?? '';
    s += rand() < 0.7 ? ' ' : '';
  }
  return s.slice(0, 2000);
}

const STATUSES = new Set(['bid', 'confirm', 'none']);

describe('T-VOX-035 parser is total (R-VOX-035)', () => {
  it('10000 random strings never throw and give well formed results', () => {
    const rand = mulberry32(20261105);
    for (let i = 0; i < 10000; i += 1) {
      const text = randomString(rand);
      for (const r of [parseBid(text), parseUtterance(text)]) {
        expect(STATUSES.has(r.status)).toBe(true);
        if (r.amountCents !== null) expect(Number.isSafeInteger(r.amountCents)).toBe(true);
        const same = new Set(r.candidates.map((c) => c.bidder?.value ?? ''));
        if (same.size <= 1) {
          const amounts = r.candidates.flatMap((c) =>
            c.amountCents === null ? [] : [c.amountCents],
          );
          expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
        }
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is deterministic: the same text gives the same result', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 300; i += 1) {
      const text = randomString(rand);
      expect(JSON.stringify(parseBid(text))).toBe(JSON.stringify(parseBid(text)));
    }
  });
});
