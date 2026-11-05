import { describe, expect, it } from 'vitest';
import { Segmenter, type SegmentEvent } from '../../src/segment/segmenter.js';
import type { SttEvent, SttWord } from '../../src/stt/provider.js';

function final(text: string, over: Partial<Extract<SttEvent, { type: 'final' }>> = {}): SttEvent {
  return {
    type: 'final',
    text,
    words: [],
    startMs: 0,
    endMs: 1000,
    confidence: 0.9,
    speechFinal: false,
    ...over,
  };
}

const interim = (text: string): SttEvent => ({ type: 'interim', text, startMs: 0 });
const segments = (evs: SegmentEvent[]): string[] =>
  evs.flatMap((e) => (e.type === 'segment' ? [e.segment.text] : []));
const drops = (evs: SegmentEvent[]): string[] =>
  evs.flatMap((e) => (e.type === 'drop' ? [e.reason] : []));

describe('T-VOX-027 segment creation (R-VOX-027)', () => {
  it('final then utterance_end gives one segment', () => {
    const s = new Segmenter();
    const a = s.push(final('three hundred'), 100);
    expect(segments(a)).toEqual([]);
    expect(segments(s.push({ type: 'utterance_end', atMs: 900 }, 900))).toEqual(['three hundred']);
  });

  it('a speechFinal final gives a segment immediately', () => {
    const s = new Segmenter();
    expect(segments(s.push(final('three hundred', { speechFinal: true }), 0))).toEqual([
      'three hundred',
    ]);
  });

  it('a lone final becomes a segment after 1500 ms and not before', () => {
    const s = new Segmenter();
    s.push(final('two fifty'), 1000);
    expect(s.tick(2499)).toEqual([]);
    expect(segments(s.tick(2500))).toEqual(['two fifty']);
    expect(s.tick(9000)).toEqual([]);
  });

  it('a newer interim keeps the final waiting', () => {
    const s = new Segmenter();
    s.push(final('paddle nine'), 0);
    s.push(interim('three'), 1000);
    expect(s.tick(5000)).toEqual([]);
    const merged = s.push(final('three hundred', { speechFinal: true, endMs: 2500 }), 5100);
    expect(segments(merged)).toEqual(['paddle nine three hundred']);
  });

  it('merges non-final parts and spans their times', () => {
    const s = new Segmenter();
    s.push(final('paddle nine', { startMs: 100, endMs: 800, confidence: 0.95 }), 900);
    const out = s.push(
      final('three hundred', { startMs: 900, endMs: 1500, confidence: 0.8, speechFinal: true }),
      1600,
    );
    const seg = out.find((e) => e.type === 'segment');
    expect(seg?.type === 'segment' && seg.segment).toMatchObject({
      seq: 1,
      text: 'paddle nine three hundred',
      startMs: 100,
      endMs: 1500,
      confidence: 0.8,
    });
  });

  it('utterance_end with nothing held does nothing; errors and states are ignored', () => {
    const s = new Segmenter();
    expect(s.push({ type: 'utterance_end', atMs: 5 }, 5)).toEqual([]);
    expect(s.push({ type: 'error', code: 'timeout', retryable: true }, 6)).toEqual([]);
    expect(s.push({ type: 'state', state: 'open' }, 7)).toEqual([]);
  });

  it('flush emits what is held', () => {
    const s = new Segmenter();
    s.push(final('four hundred'), 0);
    expect(segments(s.flush())).toEqual(['four hundred']);
  });
});

describe('T-VOX-028 interims never produce a candidate (R-VOX-028)', () => {
  it('20 interims give captions only', () => {
    const s = new Segmenter();
    const out: SegmentEvent[] = [];
    for (let i = 0; i < 20; i++) out.push(...s.push(interim('three hundred'), i * 100));
    out.push(...s.tick(10_000));
    expect(out.filter((e) => e.type === 'caption')).toHaveLength(20);
    expect(out.every((e) => e.type === 'caption')).toBe(true);
    expect(out.every((e) => e.type === 'caption' && !e.final)).toBe(true);
  });

  it('a final is also captioned, marked final', () => {
    const s = new Segmenter();
    const out = s.push(final('three hundred', { speechFinal: true }), 0);
    expect(out[0]).toEqual({ type: 'caption', text: 'three hundred', final: true, startMs: 0 });
  });
});

describe('T-VOX-033 limits (R-VOX-033)', () => {
  const words = (n: number): string => Array.from({ length: n }, () => 'word').join(' ');

  it('drops 41 words as too_long and keeps 40', () => {
    const s = new Segmenter();
    expect(drops(s.push(final(words(41), { speechFinal: true }), 0))).toEqual(['too_long']);
    expect(segments(s.push(final(words(40), { speechFinal: true }), 0))).toHaveLength(1);
  });

  it('drops a 13 s segment as too_long and keeps 12 s', () => {
    const s = new Segmenter();
    expect(
      drops(s.push(final('three hundred', { speechFinal: true, startMs: 0, endMs: 13_000 }), 0)),
    ).toEqual(['too_long']);
    expect(
      segments(s.push(final('three hundred', { speechFinal: true, startMs: 0, endMs: 12_000 }), 0)),
    ).toHaveLength(1);
  });

  it('VOX-85 flushes the earlier held finals before a merged window grows too long', () => {
    const s = new Segmenter();
    const out: SegmentEvent[] = [];
    out.push(...s.push(final('paddle five three hundred', { startMs: 0, endMs: 4000 }), 4000));
    out.push(...s.push(final('background talk', { startMs: 5000, endMs: 9000 }), 9000));
    out.push(...s.push(final('more talk', { startMs: 10_000, endMs: 14_000 }), 14_000));
    out.push(
      ...s.push(final('last bit', { startMs: 15_000, endMs: 16_000, speechFinal: true }), 16_000),
    );
    expect(drops(out)).toEqual([]);
    expect(segments(out)[0]).toContain('paddle five three hundred');
  });

  it('VOX-85 caps the number of held finals', () => {
    const s = new Segmenter();
    const out: SegmentEvent[] = [];
    for (let i = 0; i < 100; i++) {
      out.push(...s.push(final('hm', { startMs: i, endMs: i + 1 }), i));
    }
    out.push(...s.flush());
    expect(drops(out)).toEqual([]);
    expect(segments(out).length).toBeGreaterThan(1);
  });

  it('drops whitespace-only text as empty and does not caption it', () => {
    const s = new Segmenter();
    const out = s.push(final('   ', { speechFinal: true }), 0);
    expect(drops(out)).toEqual(['empty']);
    expect(out.some((e) => e.type === 'caption')).toBe(false);
  });
});

function timed(spec: Array<[string, number, number]>): SttWord[] {
  return spec.map(([word, start, end]) => ({ word, start, end, confidence: 0.9 }));
}

function sayWords(text: string, startSec: number): Array<[string, number, number]> {
  return text.split(' ').map((w, i): [string, number, number] => {
    const s = startSec + i * 0.3;
    return [w, s, s + 0.25];
  });
}

describe('T-VOX-029 gap split through the segmenter (R-VOX-029, #794)', () => {
  it('two bids separated by one second of silence become two segments', () => {
    const s = new Segmenter();
    const words = timed([
      ...sayWords('paddle five three hundred', 0),
      ...sayWords('paddle nine four hundred', 2.2),
    ]);
    const out = s.push(
      final('paddle five three hundred paddle nine four hundred', {
        words,
        startMs: 0,
        endMs: 3700,
        speechFinal: true,
      }),
      4000,
    );
    expect(segments(out)).toEqual(['paddle five three hundred', 'paddle nine four hundred']);
  });

  it('a short pause inside the text keeps one segment', () => {
    const s = new Segmenter();
    const words = timed([...sayWords('paddle five', 0), ...sayWords('three hundred', 0.9)]);
    const out = s.push(
      final('paddle five three hundred', { words, startMs: 0, endMs: 2000, speechFinal: true }),
      2000,
    );
    expect(segments(out)).toEqual(['paddle five three hundred']);
  });
});

describe('T-VOX-031 echo gate through the segmenter (R-VOX-031, #794, #795)', () => {
  it('pure auctioneer echo is dropped', () => {
    const s = new Segmenter();
    expect(drops(s.push(final('going once', { speechFinal: true }), 0))).toEqual([
      'auctioneer_talk',
    ]);
  });

  it('a bid shouted over going once keeps the bid and marks the echo', () => {
    const s = new Segmenter();
    const out = s.push(final('going once paddle nine four hundred', { speechFinal: true }), 0);
    expect(segments(out)).toEqual(['paddle nine four hundred']);
    const seg = out.find((e) => e.type === 'segment');
    expect(seg?.type === 'segment' && seg.segment.echo).toBe(true);
  });

  it('a bid followed by sold on the room mic is kept', () => {
    const s = new Segmenter();
    const out = s.push(final('paddle nine four hundred sold', { speechFinal: true }), 0);
    expect(segments(out)).toEqual(['paddle nine four hundred']);
  });
});

describe('T-VOX-032 duplicate filter through the segmenter (R-VOX-032, #794)', () => {
  it('the same text again inside 1500 ms is dropped, later it is kept', () => {
    const s = new Segmenter();
    const say = (now: number): SegmentEvent[] =>
      s.push(final('paddle five three hundred', { speechFinal: true }), now);
    expect(segments(say(0))).toHaveLength(1);
    expect(drops(say(1000))).toEqual(['duplicate']);
    expect(segments(say(5000))).toHaveLength(1);
  });
});

describe('pending candidate store on the segmenter (R-VOX-034, #794)', () => {
  it('holds a candidate for 8 s and then forgets it', () => {
    const s = new Segmenter();
    s.pending.set({ id: 'p1', bidder: { kind: 'paddle', value: '7' }, amountCents: 35000 }, 1000);
    expect(s.pending.get(5000)?.ageMs).toBe(4000);
    expect(s.pending.get(9000)).toBeUndefined();
  });
});
