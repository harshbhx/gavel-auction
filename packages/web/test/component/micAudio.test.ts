import { describe, expect, it } from 'vitest';
import { createLevelMeter, rmsLevel } from '../../src/audio/levelMeter';
import { floatToPcm16, resampleTo16k } from '../../src/audio/worklet';
import { voiceEntriesFromAudit } from '../../src/screens/console/VoiceFeed';
import type { AuditPayload } from '../../src/wire';

function row(extra: Record<string, unknown>): AuditPayload {
  return {
    bidId: 'bid-a',
    bidderId: 'bidder-a',
    source: 'voice',
    outcome: 'accepted',
    serverTs: 1,
    seq: 1,
    ...extra,
  } as unknown as AuditPayload;
}

describe('mic audio helpers', () => {
  it('keeps the level within 0..1', () => {
    expect(rmsLevel(new Float32Array(0))).toBe(0);
    expect(rmsLevel(new Float32Array([1, -1, 1, -1]))).toBe(1);
    expect(rmsLevel(new Int16Array([16384, -16384]))).toBeCloseTo(0.5, 5);
  });

  it('publishes the level at most every 50 ms', () => {
    const seen: number[] = [];
    const meter = createLevelMeter((l) => seen.push(l));
    const loud = new Float32Array([0.5, 0.5]);
    meter.push(loud, 0);
    meter.push(loud, 20);
    meter.push(loud, 49);
    meter.push(loud, 50);
    expect(seen).toHaveLength(2);
  });

  it('converts to 16 kHz 16 bit mono', () => {
    expect(Array.from(floatToPcm16(new Float32Array([0, 1, -1])))).toEqual([0, 32767, -32768]);
    expect(resampleTo16k(new Float32Array(48000), 48000)).toHaveLength(16000);
    const same = new Float32Array(10);
    expect(resampleTo16k(same, 16000)).toBe(same);
  });
});

describe('voiceEntriesFromAudit', () => {
  it('maps voice rows to final entries with a parse or none', () => {
    const entries = voiceEntriesFromAudit(
      [
        row({
          bidId: 'one',
          transcript: 'twelve for three fifty',
          parsedAmount: 35000,
          confidence: 0.93,
        }),
        row({ bidId: 'two', transcript: 'hello there' }),
        row({ bidId: 'three', source: 'manual' }),
      ],
      () => 12,
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]?.parse?.bid).toEqual({ paddle: 12, amountCents: 35000, confidence: 0.93 });
    expect(entries[1]?.parse?.bid).toBeNull();
    expect(entries.every((e) => e.final)).toBe(true);
  });
});
