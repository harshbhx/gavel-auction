import { describe, expect, it, vi } from 'vitest';
import { isAuctioneerEcho, parseUnlessEcho } from '../../src/segment/echo.js';
import { splitAtGaps } from '../../src/segment/split.js';
import { parseBid } from '../../src/parser/parse.js';
import type { SttWord } from '../../src/stt/provider.js';

/** Words with explicit gaps in ms before each word (the first gap is ignored). */
function timed(spec: Array<[string, number]>): SttWord[] {
  let t = 0;
  return spec.map(([word, gapMs]) => {
    const start = t + gapMs / 1000;
    t = start + 0.2;
    return { word, start, end: t, confidence: 0.9 };
  });
}
const texts = (groups: SttWord[][]): string[] => groups.map((g) => g.map((w) => w.word).join(' '));

describe('T-VOX-029 gap split (R-VOX-029)', () => {
  it('splits at a 900 ms gap between "three hundred" and "paddle nine"', () => {
    const words = timed([
      ['three', 0],
      ['hundred', 50],
      ['paddle', 900],
      ['nine', 50],
    ]);
    expect(texts(splitAtGaps(words))).toEqual(['three hundred', 'paddle nine']);
  });

  it('does not split at a 400 ms gap', () => {
    const words = timed([
      ['three', 0],
      ['hundred', 50],
      ['paddle', 400],
      ['nine', 50],
    ]);
    expect(splitAtGaps(words)).toHaveLength(1);
  });

  it('splits at exactly 700 ms', () => {
    const words = timed([
      ['paddle', 0],
      ['nine', 50],
      ['going', 700],
    ]);
    expect(texts(splitAtGaps(words))).toEqual(['paddle nine', 'going']);
  });

  it('does not split inside a number span, even with a 900 ms gap', () => {
    const words = timed([
      ['two', 0],
      ['fifty', 900],
    ]);
    expect(splitAtGaps(words)).toHaveLength(1);
    const withAnd = timed([
      ['four', 0],
      ['hundred', 50],
      ['and', 900],
      ['fifty', 50],
    ]);
    expect(splitAtGaps(withAnd)).toHaveLength(1);
  });

  it('handles empty input', () => {
    expect(splitAtGaps([])).toEqual([]);
  });
});

describe('T-VOX-030 multiple bidders stay together (R-VOX-030)', () => {
  it('keeps two paddle references in one segment and the parser flags multiple_bidders', () => {
    const words = timed(
      'paddle five two fifty paddle nine two sixty'
        .split(' ')
        .map((w): [string, number] => [w, 100]),
    );
    expect(splitAtGaps(words)).toHaveLength(1);
    const r = parseBid('paddle five two fifty paddle nine two sixty');
    expect(r.status).toBe('confirm');
    expect(r.reason).toBe('multiple_bidders');
  });
});

describe('T-VOX-031 auctioneer echo (R-VOX-031)', () => {
  it('drops echo phrases before parsing; the parser is never called', () => {
    for (const text of ['going once going twice sold', 'the price is two fifty', 'Fair warning!']) {
      const spy = vi.fn(parseBid);
      expect(parseUnlessEcho(text, spy)).toEqual({ dropped: true, reason: 'auctioneer_talk' });
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('passes other text through to the parser', () => {
    const spy = vi.fn((t: string) => parseBid(t, { speakerBidderId: '7' }));
    const out = parseUnlessEcho('three hundred', spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out.dropped).toBe(false);
    expect(isAuctioneerEcho('paddle nine two fifty')).toBe(false);
    expect(isAuctioneerEcho('unsold')).toBe(false);
  });
});
