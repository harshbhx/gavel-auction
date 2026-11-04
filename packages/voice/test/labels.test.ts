import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkWav,
  labelSchema,
  manifestToLabels,
  validateCoverage,
  validateFiles,
  validateLabelsJson,
  validateManifest,
  manifestRowSchema,
  type Label,
} from '../scripts/validate-labels.js';
import { z } from 'zod';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/audio/${name}`, import.meta.url), 'utf8'));
}

const manifest = fixture('manifest.json');
const labels: Label[] = manifestToLabels(z.array(manifestRowSchema).parse(manifest));

/** Minimal 16 kHz mono s16le WAV of the given length. */
function wav(
  seconds: number,
  over: { rate?: number; channels?: number; bits?: number } = {},
): Uint8Array {
  const rate = over.rate ?? 16000;
  const channels = over.channels ?? 1;
  const bits = over.bits ?? 16;
  const dataBytes = Math.round(seconds * 16000) * 2;
  const buf = new Uint8Array(44 + dataBytes);
  const dv = new DataView(buf.buffer);
  const put = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i);
  };
  put(0, 'RIFF');
  dv.setUint32(4, 36 + dataBytes, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, (rate * channels * bits) / 8, true);
  dv.setUint16(32, (channels * bits) / 8, true);
  dv.setUint16(34, bits, true);
  put(36, 'data');
  dv.setUint32(40, dataBytes, true);
  return buf;
}

describe('T-VOX-081 audio fixture manifest (R-VOX-073)', () => {
  it('is valid with no problems', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('meets every coverage floor', () => {
    expect(labels.length).toBeGreaterThanOrEqual(24);
    expect(new Set(labels.map((l) => l.category)).size).toBeGreaterThanOrEqual(8);
    expect(
      new Set(labels.map((l) => `${l.noise.type}:${String(l.noise.snrDb)}`)).size,
    ).toBeGreaterThanOrEqual(3);
    expect(new Set(labels.map((l) => l.voice)).size).toBeGreaterThanOrEqual(3);
    expect(labels.filter((l) => l.expected.outcome === 'confirm').length).toBeGreaterThanOrEqual(4);
    expect(labels.filter((l) => l.expected.outcome === 'none').length).toBeGreaterThanOrEqual(3);
  });

  it('keeps the section 10 ids a01..a24 with distinct seeds', () => {
    expect(labels.map((l) => l.id)).toEqual(
      Array.from({ length: 24 }, (_, i) => `a${String(i + 1).padStart(2, '0')}`),
    );
    const seeds = z
      .array(manifestRowSchema)
      .parse(manifest)
      .map((r) => r.seed);
    expect(new Set(seeds).size).toBe(24);
  });

  it('produces entries that satisfy the labels schema', () => {
    expect(validateLabelsJson(labels)).toEqual([]);
    for (const l of labels) expect(labelSchema.safeParse(l).success).toBe(true);
  });

  it('keeps labels.schema.json in step with the validator', () => {
    const schema = fixture('labels.schema.json') as {
      definitions: { label: { required: string[]; properties: Record<string, unknown> } };
    };
    expect([...schema.definitions.label.required].sort()).toEqual(
      Object.keys(labelSchema.shape).sort(),
    );
    expect(Object.keys(schema.definitions.label.properties).sort()).toEqual(
      Object.keys(labelSchema.shape).sort(),
    );
  });
});

describe('coverage failures are reported', () => {
  const base = labels;
  it('too few utterances', () => {
    expect(validateCoverage(base.slice(0, 10)).join('\n')).toMatch(/at least 24/);
  });
  it('missing crowd noise', () => {
    const l = base.map((x) =>
      x.noise.type === 'crowd' ? { ...x, noise: { type: 'cafe' as const, snrDb: 10 } } : x,
    );
    expect(validateCoverage(l).join('\n')).toMatch(/crowd:5/);
  });
  it('too few non-US voices', () => {
    const l = base.map((x) => (x.voice.includes('-GB-') ? { ...x, voice: 'tts-en-US-1' } : x));
    expect(validateCoverage(l).join('\n')).toMatch(/non-US/);
  });
  it('a bid with both paddle and speaker', () => {
    const l = base.map((x) => (x.id === 'a07' ? { ...x, speakerBidderId: '3' } : x));
    expect(validateCoverage(l).join('\n')).toMatch(/a07/);
  });
  it('rejects unknown fields', () => {
    expect(validateLabelsJson([{ ...base[0], extra: 1 }])[0]).toMatch(/labels/);
  });
});

describe('WAV format check', () => {
  it('accepts 16 kHz mono s16le between 0.5 and 6 s', () => {
    expect(checkWav(wav(0.5))).toEqual([]);
    expect(checkWav(wav(3))).toEqual([]);
    expect(checkWav(wav(6))).toEqual([]);
  });
  it('rejects wrong rate, channels, bit depth and durations', () => {
    expect(checkWav(wav(2, { rate: 44100 }))).toContain('sample rate is not 16000');
    expect(checkWav(wav(2, { channels: 2 }))).toContain('not mono');
    expect(checkWav(wav(2, { bits: 24 }))).toContain('not 16-bit');
    expect(checkWav(wav(0.2)).join()).toMatch(/duration/);
    expect(checkWav(wav(7)).join()).toMatch(/duration/);
    expect(checkWav(new Uint8Array(10))).toEqual(['not a RIFF/WAVE file']);
  });
  it('checks files when they exist and skips or fails on missing ones', () => {
    const present = new Map<string, Uint8Array>([['/a/a01-three-hundred-clean.wav', wav(1)]]);
    const opts = {
      audioDir: '/a',
      exists: (p: string) => present.has(p),
      read: (p: string) => present.get(p) ?? new Uint8Array(),
    };
    expect(validateFiles(labels, opts)).toEqual([]);
    expect(validateFiles(labels, { ...opts, requireFiles: true }).length).toBe(23);
    present.set('/a/a01-three-hundred-clean.wav', wav(0.1));
    expect(validateFiles(labels, opts)[0]).toMatch(/a01: duration/);
  });
});
