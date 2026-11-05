import { describe, expect, it } from 'vitest';
import { parseBid } from '../../src/parser/parse.js';
import {
  FaultTracker,
  SttWatch,
  checkTranscript,
  maskProfanity,
} from '../../src/pipeline/faults.js';

describe('T-VOX-094 STT silence (R-VOX-086)', () => {
  it('degrades at 8 s and goes down at 15 s while the meter shows speech', () => {
    const f = new FaultTracker();
    for (let t = 0; t <= 16_000; t += 1000) f.stt.noteSpeech(t);
    expect(f.snapshot(7000).stt).toBe('ok');
    expect(f.snapshot(8000).stt).toBe('degraded');
    expect(f.snapshot(8000).banners).toEqual(['manual_entry']);
    const down = f.snapshot(15_000);
    expect(down.stt).toBe('down');
    expect(down.banners).toContain('manual_entry');
  });

  it('a final clears it, and plain silence is not a fault', () => {
    const w = new SttWatch();
    w.noteSpeech(0);
    w.noteSpeech(9000);
    expect(w.status(9000)).toBe('degraded');
    w.noteFinal();
    expect(w.status(9500)).toBe('ok');
    const quiet = new SttWatch();
    quiet.noteSpeech(0);
    expect(quiet.status(20_000)).toBe('ok');
  });
});

describe('T-VOX-095 empty and filler transcripts (R-VOX-087)', () => {
  it('drops them as empty or no_amount', () => {
    expect(checkTranscript('')).toEqual({ kind: 'drop', reason: 'empty' });
    expect(checkTranscript('   ')).toEqual({ kind: 'drop', reason: 'empty' });
    expect(checkTranscript('...')).toEqual({ kind: 'drop', reason: 'empty' });
    expect(checkTranscript('uh')).toEqual({ kind: 'drop', reason: 'no_amount' });
    expect(checkTranscript('um hmm')).toEqual({ kind: 'drop', reason: 'no_amount' });
    expect(checkTranscript('paddle five three hundred')).toEqual({ kind: 'ok' });
  });
});

describe('T-VOX-096 garbage and profanity (R-VOX-088)', () => {
  it('drops garbage without throwing', () => {
    const cases = ['السلام عليكم', 'a'.repeat(24), 'x '.repeat(1250), 'three\u0000hundred'];
    for (const c of cases) expect(checkTranscript(c)).toEqual({ kind: 'drop', reason: 'garbage' });
  });

  it('still parses a profane bid and masks the word in captions', () => {
    const text = 'damn three hundred';
    expect(checkTranscript(text)).toEqual({ kind: 'ok' });
    expect(parseBid(text, { speakerBidderId: '7' }).amountCents).toBe(30000);
    expect(maskProfanity(text)).toBe('d*** three hundred');
  });
});

describe('T-VOX-097 model outage (R-VOX-089)', () => {
  it('goes down on a failure and recovers on the next success', () => {
    const f = new FaultTracker();
    f.noteLlm(false);
    expect(f.snapshot(0).llm).toBe('down');
    expect(f.snapshot(0).bidsAllowed).toBe(true);
    f.noteLlm(true);
    expect(f.snapshot(0).llm).toBe('ok');
  });
});

describe('T-VOX-098 both services down (R-VOX-090)', () => {
  it('allows no bids, shows both banners and emits stt_unavailable once per 30 s', () => {
    const f = new FaultTracker();
    for (let t = 0; t <= 60_000; t += 1000) f.stt.noteSpeech(t);
    f.noteLlm(false);
    const snap = f.snapshot(16_000);
    expect(snap.bidsAllowed).toBe(false);
    expect(snap.banners).toEqual(['manual_entry', 'qr_bids']);
    expect(f.shouldEmitUnavailable(16_000)).toBe(true);
    expect(f.shouldEmitUnavailable(20_000)).toBe(false);
    expect(f.shouldEmitUnavailable(46_000)).toBe(true);
  });
});
