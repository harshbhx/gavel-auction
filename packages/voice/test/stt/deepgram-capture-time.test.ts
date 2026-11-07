import { describe, expect, it } from 'vitest';
import {
  FLAG_END_OF_UTTERANCE,
  FLAG_KEEPALIVE,
  FRAME_SAMPLES,
  type AudioBatch,
} from '../../src/audio/frame.js';
import { DeepgramStt } from '../../src/stt/deepgram.js';
import { buildDeepgramUrl, mergeDeepgramConfig } from '../../src/stt/deepgram-config.js';
import { ReconnectingDeepgramStt } from '../../src/stt/deepgram-reconnect.js';
import { FakeScheduler, flush, mockFactory, record } from './deepgram-mock.js';

const START = { keyterms: [], language: 'en' as const };

/** 20 ms of audio stamped on the capture clock. */
function frame(tsMs: number): AudioBatch {
  return { seq: tsMs, tsMs, flags: 0, pcm: new Int16Array(FRAME_SAMPLES) };
}

function results(startS: number, durS: number) {
  return {
    type: 'Results',
    is_final: true,
    speech_final: true,
    start: startS,
    duration: durS,
    channel: {
      alternatives: [
        {
          transcript: 'paddle seven five hundred',
          confidence: 0.9,
          words: [{ word: 'paddle', start: startS, end: startS + 0.02, confidence: 0.9 }],
        },
      ],
    },
  };
}

describe('R12-V05 Deepgram event times are on the capture timeline', () => {
  it('maps a final after a muted gap to the capture clock of the audio that was sent', async () => {
    const clock = new FakeScheduler();
    const { factory, sockets } = mockFactory();
    const dg = new DeepgramStt({ apiKey: 'k', socket: factory, scheduler: clock });
    const rec = record(dg);
    await dg.start(START);
    // Two seconds of audio at t=0, then 18 s of mute (keepalive only), then audio at t=20 s.
    for (let t = 0; t < 2000; t += 20) dg.write(frame(t));
    dg.write({ seq: 1, tsMs: 10_000, flags: FLAG_KEEPALIVE, pcm: new Int16Array(0) });
    for (let t = 20_000; t < 22_000; t += 20) dg.write(frame(t));
    // The vendor has seen 4 s; the second utterance is at vendor 2.0 to 4.0 s.
    sockets[0]?.message(results(2.0, 2.0));
    await flush();
    const final = rec.events.find((e) => e.type === 'final');
    expect(final?.type === 'final' && final.startMs).toBe(20_000);
    expect(final?.type === 'final' && final.endMs).toBe(22_000);
    if (final?.type === 'final') expect(final.words[0]?.start).toBeCloseTo(20, 3);
    await dg.stop();
  });

  it('starts a fresh map on a reconnect', async () => {
    const clock = new FakeScheduler();
    const { factory, sockets } = mockFactory();
    const dg = new ReconnectingDeepgramStt({ apiKey: 'k', socket: factory, scheduler: clock });
    const rec = record(dg);
    await dg.start(START);
    for (let t = 0; t < 1000; t += 20) dg.write(frame(t));
    sockets[0]?.serverClose(1006);
    await clock.advance(300);
    await flush();
    expect(sockets).toHaveLength(2);
    for (let t = 30_000; t < 31_000; t += 20) dg.write(frame(t));
    // The new socket counts from 0 again.
    sockets[1]?.message(results(0, 1.0));
    await flush();
    const final = rec.events.find((e) => e.type === 'final');
    expect(final?.type === 'final' && final.startMs).toBe(30_000);
    expect(final?.type === 'final' && final.endMs).toBe(31_000);
    await dg.stop();
  });
});

describe('R12-V06 end of utterance reaches Deepgram', () => {
  it('sends Finalize for a keepalive batch that ends the utterance', async () => {
    const clock = new FakeScheduler();
    const { factory, sockets } = mockFactory();
    const dg = new DeepgramStt({ apiKey: 'k', socket: factory, scheduler: clock });
    await dg.start(START);
    dg.write(frame(0));
    expect(sockets[0]?.texts).not.toContain('{"type":"Finalize"}');
    dg.write({
      seq: 2,
      tsMs: 20,
      flags: FLAG_KEEPALIVE | FLAG_END_OF_UTTERANCE,
      pcm: new Int16Array(0),
    });
    expect(sockets[0]?.texts).toContain('{"type":"Finalize"}');
    await dg.stop();
  });
});

describe('R12-V02 Deepgram config', () => {
  it('asks for punctuation and smart formatting', () => {
    const q = new URL(buildDeepgramUrl(mergeDeepgramConfig())).searchParams;
    expect(q.get('punctuate')).toBe('true');
    expect(q.get('smart_format')).toBe('false');
  });
});
