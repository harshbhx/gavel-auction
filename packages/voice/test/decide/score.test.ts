import { describe, expect, it } from 'vitest';
import { score, type ScoreInput } from '../../src/decide/score.js';

const CASES: Array<[string, ScoreInput, number]> = [
  ['clean agree_clean cap', { flags: [], wordConfidences: [0.95], merge: 'agree_clean' }, 0.99],
  [
    'two fifty agree',
    { flags: ['colloquial_hundreds'], wordConfidences: [0.9], merge: 'agree' },
    0.92,
  ],
  [
    'two fifty model down',
    { flags: ['colloquial_hundreds'], wordConfidences: [0.9], merge: 'model_unavailable' },
    0.78,
  ],
  ['tree hundred', { flags: ['asr_repair'], wordConfidences: [0.7], merge: 'agree' }, 0.72],
  ['clean agree', { flags: [], wordConfidences: [0.95], merge: 'agree' }, 0.97],
  ['no word confidences', { flags: [], wordConfidences: [], merge: 'agree' }, 0.87],
  ['no confidences agree_clean', { flags: [], wordConfidences: [], merge: 'agree_clean' }, 0.89],
  [
    'two repairs',
    { flags: ['asr_repair', 'asr_repair'], wordConfidences: [0.9], merge: 'agree' },
    0.79,
  ],
  [
    'three repairs capped at two',
    { flags: ['asr_repair', 'asr_repair', 'asr_repair'], wordConfidences: [0.9], merge: 'agree' },
    0.79,
  ],
  ['make it', { flags: ['make_it'], wordConfidences: [0.9], merge: 'agree' }, 0.92],
  [
    'homophone',
    { flags: [], wordConfidences: [0.9], merge: 'agree', homophonePossible: true },
    0.78,
  ],
  ['many tokens', { flags: [], wordConfidences: [0.9], merge: 'agree', wordCount: 11 }, 0.92],
  [
    'ten words is not many',
    { flags: [], wordConfidences: [0.9], merge: 'agree', wordCount: 10 },
    0.97,
  ],
  ['min word wins', { flags: [], wordConfidences: [0.99, 0.5], merge: 'agree' }, 0.57],
  ['zero conf', { flags: [], wordConfidences: [0], merge: 'agree' }, 0],
];

describe('T-VOX-070 confidence formula (R-VOX-062)', () => {
  it.each(CASES)('%s', (_name, input, expected) => {
    expect(score(input)).toBe(expected);
  });

  it('never exceeds 0.99 and has at most 2 decimals', () => {
    const v = score({ flags: [], wordConfidences: [1], merge: 'agree_clean' });
    expect(v).toBe(0.99);
    expect(Math.round(v * 100) / 100).toBe(v);
  });

  it('is deterministic', () => {
    const input: ScoreInput = { flags: ['make_it'], wordConfidences: [0.8], merge: 'agree' };
    expect(score(input)).toBe(score(input));
  });
});

describe('segment confidence without word confidences (R7-05)', () => {
  it('keeps a low Groq transcript confidence under the auto threshold', () => {
    const low = score({ flags: [], wordConfidences: [], segmentConfidence: 0.22, merge: 'agree' });
    expect(low).toBeLessThan(0.85);
    expect(low).toBe(0.25);
  });

  it('does not penalise a confident segment and ignores it when words exist', () => {
    const high = score({ flags: [], wordConfidences: [], segmentConfidence: 0.95, merge: 'agree' });
    expect(high).toBe(0.97);
    const words = score({
      flags: [],
      wordConfidences: [0.95],
      segmentConfidence: 0.1,
      merge: 'agree',
    });
    expect(words).toBe(0.97);
  });
});
