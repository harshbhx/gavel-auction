import { describe, expect, it } from 'vitest';
import {
  FRAME_SAMPLES,
  WavError,
  buildReport,
  latencySummary,
  normalizeText,
  parseWav,
  reportMarkdown,
  summarizeClip,
  toBatches,
  type ClipObservation,
} from '../src/voice/live-socket';

// Pure parts of the live /audio socket run (issue 2194): WAV reading, batching, per-clip summary
// and the verdict. The network run itself happens only in the dispatch workflow.

function wav(samples: number[], rate = 16_000, channels = 1, extraChunk = false): Uint8Array {
  const data = new Int16Array(samples);
  const extra = extraChunk ? 8 + 4 : 0;
  const buf = new Uint8Array(12 + 24 + extra + 8 + data.length * 2);
  const v = new DataView(buf.buffer);
  const put = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) buf[at + i] = s.charCodeAt(i);
  };
  put(0, 'RIFF');
  v.setUint32(4, buf.length - 8, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  let at = 36;
  if (extraChunk) {
    put(at, 'LIST');
    v.setUint32(at + 4, 4, true);
    put(at + 8, 'INFO');
    at += 12;
  }
  put(at, 'data');
  v.setUint32(at + 4, data.length * 2, true);
  for (let i = 0; i < data.length; i += 1) v.setInt16(at + 8 + i * 2, data[i] ?? 0, true);
  return buf;
}

describe('parseWav', () => {
  it('reads 16 bit PCM and its format', () => {
    const r = parseWav(wav([1, -2, 300, -32768]));
    expect(r.sampleRate).toBe(16_000);
    expect(r.channels).toBe(1);
    expect([...r.samples]).toEqual([1, -2, 300, -32768]);
  });
  it('skips chunks it does not know', () => {
    expect([...parseWav(wav([5, 6], 16_000, 1, true)).samples]).toEqual([5, 6]);
  });
  it('refuses a file that is not WAVE or has no data', () => {
    expect(() => parseWav(new Uint8Array(20))).toThrow(WavError);
    expect(() => parseWav(wav([1]).subarray(0, 40))).toThrow(WavError);
  });
  it('reports another sample rate instead of resampling', () => {
    expect(parseWav(wav([1, 2], 24_000)).sampleRate).toBe(24_000);
  });
});

describe('toBatches', () => {
  it('cuts whole 20 ms frames, five per batch, and pads the tail with silence', () => {
    const samples = new Int16Array(FRAME_SAMPLES * 5 * 2 + 10).fill(7);
    const b = toBatches(samples);
    expect(b.map((x) => x.frames)).toEqual([5, 5, 1]);
    expect(b.map((x) => x.offsetMs)).toEqual([0, 100, 200]);
    const last = b[2]?.pcm;
    expect(last?.length).toBe(FRAME_SAMPLES);
    expect(last?.[9]).toBe(7);
    expect(last?.[10]).toBe(0);
  });
  it('never returns an empty batch and handles an empty clip', () => {
    expect(toBatches(new Int16Array(0))).toEqual([]);
    expect(toBatches(new Int16Array(1))[0]?.frames).toBe(1);
  });
});

describe('normalizeText', () => {
  it('lower cases and strips punctuation', () => {
    expect(normalizeText('Paddle seven,  five hundred dollars.')).toBe(
      'paddle seven five hundred dollars',
    );
  });
});

function obs(over: Partial<ClipObservation> = {}): ClipObservation {
  return {
    id: 'a01',
    spokenText: 'three hundred',
    expected: { outcome: 'bid', amountCents: 30000 },
    startedAt: 1000,
    speechEndAt: 3000,
    endedAt: 9000,
    captions: [],
    statuses: [],
    confirmPrompts: [],
    pricesWithLeader: [],
    ...over,
  };
}

describe('summarizeClip', () => {
  it('computes latency from the end of speech to the first final caption', () => {
    const row = summarizeClip(
      obs({
        captions: [
          { at: 3100, text: 'three', final: false },
          { at: 3600, text: 'Three hundred.', final: true },
          { at: 3900, text: 'again', final: true },
        ],
      }),
    );
    expect(row.providerAnswered).toBe(true);
    expect(row.captionLatencyMs).toBe(600);
    expect(row.transcriptMatchesSpokenText).toBe(false); // two finals joined
    expect(row.transcript).toBe('Three hundred. again');
  });
  it('matches the spoken text after normalising', () => {
    const row = summarizeClip(
      obs({ captions: [{ at: 3500, text: 'Three hundred.', final: true }] }),
    );
    expect(row.transcriptMatchesSpokenText).toBe(true);
  });
  it('counts a clip with only partial or blank captions as unanswered', () => {
    const row = summarizeClip(
      obs({
        captions: [
          { at: 3100, text: 'thr', final: false },
          { at: 3200, text: '   ', final: true },
        ],
      }),
    );
    expect(row.providerAnswered).toBe(false);
    expect(row.captionLatencyMs).toBeNull();
  });
  it('classifies the room decision', () => {
    expect(summarizeClip(obs()).roomDecision).toBe('no_room_action');
    expect(
      summarizeClip(obs({ confirmPrompts: [{ paddle: '4', amountCents: 30000 }] })).roomDecision,
    ).toBe('confirm_prompt');
    const auto = summarizeClip(
      obs({ confirmPrompts: [{ paddle: '4', amountCents: 30000 }], pricesWithLeader: [30000] }),
    );
    expect(auto.roomDecision).toBe('auto_accepted');
    expect(auto.autoAcceptedBids).toBe(1);
  });
});

describe('buildReport', () => {
  const answered = summarizeClip(
    obs({
      captions: [{ at: 3500, text: 'three hundred', final: true }],
      confirmPrompts: [{ paddle: '4', amountCents: 30000 }],
    }),
  );
  const silent = summarizeClip(obs({ id: 'a02' }));
  const base = { provider: 'groq' as const, generatedAt: '2026-11-09T00:00:00.000Z', runUrl: '' };

  it('passes when the provider answered and nothing was accepted without a confirm', () => {
    const r = buildReport({ ...base, rows: [answered, silent] });
    expect(r.verdict).toBe('PASS');
    expect(r.providerAnswered).toBe(1);
    expect(r.clips).toBe(2);
    expect(r.confirmPrompts).toBe(1);
    expect(r.noRoomAction).toBe(1);
    expect(r.verdictReason).toContain('1 of 2');
    expect(r.captionLatencyMs).toEqual({ count: 1, min: 500, p50: 500, p95: 500, max: 500 });
  });
  it('fails when no clip got a transcript', () => {
    const r = buildReport({ ...base, rows: [silent] });
    expect(r.verdict).toBe('FAIL');
    expect(r.captionLatencyMs).toBeNull();
  });
  it('fails on a bid accepted without a confirm', () => {
    const auto = summarizeClip(
      obs({ captions: [{ at: 3500, text: 'x', final: true }], pricesWithLeader: [30000] }),
    );
    const r = buildReport({ ...base, rows: [answered, auto] });
    expect(r.verdict).toBe('FAIL');
    expect(r.autoAcceptedBids).toBe(1);
  });
  it('fails with no clips', () => {
    expect(buildReport({ ...base, rows: [] }).verdict).toBe('FAIL');
  });
  it('renders a verdict line and one table row per clip', () => {
    const text = reportMarkdown(buildReport({ ...base, rows: [answered, silent] }));
    expect(text).toContain('VOICE LIVE SOCKET VERDICT: PASS');
    expect(text.split('\n').filter((l) => l.startsWith('| a0'))).toHaveLength(2);
  });
});

describe('latencySummary', () => {
  it('uses nearest-rank percentiles', () => {
    const s = latencySummary([100, 200, 300, 400, 1000]);
    expect(s).toEqual({ count: 5, min: 100, p50: 300, p95: 1000, max: 1000 });
  });
});
