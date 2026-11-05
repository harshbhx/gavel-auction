import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkTimeline } from '../scripts/check-replay-assets.js';

const dir = new URL('../fixtures/replay/', import.meta.url);

describe('replay clip fixture (T-VOX-092)', () => {
  it('timeline has a bid, a confirm and a non-bid within 90 s', () => {
    const timeline = JSON.parse(readFileSync(new URL('timeline.json', dir), 'utf8'));
    expect(checkTimeline(timeline)).toEqual({ ok: true, errors: [] });
  });

  it('wav is 16 kHz mono 16 bit, at most 90 s and 3 MB', () => {
    const file = new URL('auction-demo.wav', dir);
    const b = readFileSync(file);
    expect(b.toString('ascii', 0, 4)).toBe('RIFF');
    expect(b.toString('ascii', 8, 12)).toBe('WAVE');
    expect(b.readUInt16LE(22)).toBe(1);
    expect(b.readUInt32LE(24)).toBe(16000);
    expect(b.readUInt16LE(34)).toBe(16);
    const seconds = b.readUInt32LE(40) / 32000;
    expect(seconds).toBeLessThanOrEqual(90);
    expect(statSync(file).size).toBeLessThanOrEqual(3 * 1024 * 1024);
  });
});
