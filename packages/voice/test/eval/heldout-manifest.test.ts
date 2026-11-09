import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  expandHeldout,
  HELDOUT_SNRS_DB,
  noiseOf,
  type HeldoutUtterance,
} from '../../scripts/heldout-manifest.js';

const read = (p: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));

const utterances = read('fixtures/audio-heldout/utterances.json') as HeldoutUtterance[];
const manifest = read('fixtures/audio-heldout/manifest.json') as unknown[];
const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim();

describe('G5 held-out noisy set manifest (issue 2192)', () => {
  it('the committed manifest is the expansion of the utterance list', () => {
    expect(manifest).toEqual(expandHeldout(utterances));
  });

  it('has 40 utterances and 120 clips, 40 per SNR, 20 of each noise kind per SNR', () => {
    const clips = expandHeldout(utterances);
    expect(utterances).toHaveLength(40);
    expect(clips).toHaveLength(120);
    for (const snr of HELDOUT_SNRS_DB) {
      const cell = clips.filter((c) => c.snrDb === snr);
      expect(cell).toHaveLength(40);
      expect(cell.filter((c) => c.noise === 'room')).toHaveLength(20);
      expect(cell.filter((c) => c.noise === 'babble')).toHaveLength(20);
    }
    expect(noiseOf(1)).toBe('babble');
    expect(noiseOf(2)).toBe('room');
  });

  it('clip ids and seeds are unique', () => {
    const clips = expandHeldout(utterances);
    expect(new Set(clips.map((c) => c.id)).size).toBe(120);
    expect(new Set(clips.map((c) => c.seed)).size).toBe(120);
  });

  it('shares no text with the dev and held-out text cases or the 24 clips', () => {
    const cases = read('fixtures/text/cases.json') as Array<{ text: string }>;
    const clips = read('fixtures/audio/manifest.json') as Array<{ text: string }>;
    const old = new Set([...cases, ...clips].map((c) => norm(c.text)));
    expect(utterances.filter((u) => old.has(norm(u.text))).map((u) => u.text)).toEqual([]);
  });
});
