import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkTimeline } from '../scripts/check-replay-assets.js';

const schema = JSON.parse(
  readFileSync(new URL('../fixtures/replay/timeline.schema.json', import.meta.url), 'utf8'),
);

const VALID_TIMELINE = {
  utterances: [
    { startMs: 0, endMs: 5000, expected: 'bid' },
    { startMs: 10000, endMs: 15000, expected: 'confirm' },
    { startMs: 20000, endMs: 25000, expected: 'none' },
  ],
};

describe('replay timeline schema (T-VOX-092)', () => {
  it('schema requires utterances array', () => {
    expect(schema.required).toContain('utterances');
    expect(schema.properties.utterances.type).toBe('array');
  });

  it('utterance items require startMs, endMs, expected', () => {
    const itemSchema = schema.properties.utterances.items;
    expect(itemSchema.required).toContain('startMs');
    expect(itemSchema.required).toContain('endMs');
    expect(itemSchema.required).toContain('expected');
  });

  it('expected enum includes bid, confirm, none', () => {
    const expectedEnum = schema.properties.utterances.items.properties.expected.enum;
    expect(expectedEnum).toContain('bid');
    expect(expectedEnum).toContain('confirm');
    expect(expectedEnum).toContain('none');
  });
});

describe('checkTimeline (T-VOX-092)', () => {
  it('passes for valid timeline with bid, confirm, none', () => {
    const result = checkTimeline(VALID_TIMELINE);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects timeline exceeding 90 s', () => {
    const long = {
      utterances: [
        { startMs: 0, endMs: 5000, expected: 'bid' as const },
        { startMs: 10000, endMs: 15000, expected: 'confirm' as const },
        { startMs: 85000, endMs: 91000, expected: 'none' as const },
      ],
    };
    const result = checkTimeline(long);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds'))).toBe(true);
  });

  it('rejects timeline missing a bid', () => {
    const noBid = {
      utterances: [
        { startMs: 0, endMs: 5000, expected: 'confirm' as const },
        { startMs: 10000, endMs: 15000, expected: 'none' as const },
      ],
    };
    const result = checkTimeline(noBid);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('bid'))).toBe(true);
  });

  it('rejects timeline missing a confirm', () => {
    const noConfirm = {
      utterances: [
        { startMs: 0, endMs: 5000, expected: 'bid' as const },
        { startMs: 10000, endMs: 15000, expected: 'none' as const },
      ],
    };
    const result = checkTimeline(noConfirm);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('confirm'))).toBe(true);
  });

  it('rejects timeline missing a none', () => {
    const noNone = {
      utterances: [
        { startMs: 0, endMs: 5000, expected: 'bid' as const },
        { startMs: 10000, endMs: 15000, expected: 'confirm' as const },
      ],
    };
    const result = checkTimeline(noNone);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('none'))).toBe(true);
  });

  it('rejects utterance where endMs <= startMs', () => {
    const bad = {
      utterances: [
        { startMs: 5000, endMs: 5000, expected: 'bid' as const },
        { startMs: 10000, endMs: 15000, expected: 'confirm' as const },
        { startMs: 20000, endMs: 25000, expected: 'none' as const },
      ],
    };
    const result = checkTimeline(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('endMs <= startMs'))).toBe(true);
  });
});
