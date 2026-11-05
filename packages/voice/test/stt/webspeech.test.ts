import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRAME_SAMPLES } from '../../src/audio/frame.js';
import {
  WEBSPEECH_FALLBACK_CONFIDENCE,
  WEBSPEECH_LABEL,
  WebSpeechStt,
  type RecognitionEvent,
  type SpeechRecognitionLike,
} from '../../src/stt/webspeech.js';
import { FakeScheduler, flush, record } from './deepgram-mock.js';

class StubRecognition implements SpeechRecognitionLike {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((ev: RecognitionEvent) => void) | null = null;
  onerror: ((ev: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  stops = 0;
  endOnStop = true;

  start(): void {
    this.starts += 1;
  }

  stop(): void {
    this.stops += 1;
    if (this.endOnStop) queueMicrotask(() => this.onend?.());
  }

  say(text: string, isFinal: boolean, confidence = 0.9, resultIndex = 0): void {
    const alt = { transcript: text, confidence };
    const result = Object.assign([alt], { isFinal });
    this.onresult?.({ resultIndex, results: Object.assign([result], { length: 1 }) });
  }
}

function make(stub: StubRecognition | null = new StubRecognition()) {
  const clock = new FakeScheduler();
  const provider = new WebSpeechStt({
    recognition: () => stub,
    now: () => clock.t,
    scheduler: clock,
  });
  return { stub, clock, provider };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WebSpeechStt (T-VOX-021)', () => {
  it('maps stub results to interim and final events, text and confidence only', async () => {
    const { stub, clock, provider } = make();
    const rec = record(provider);
    await provider.start();
    clock.t = 100;
    stub?.say('paddle', false, 0);
    clock.t = 400;
    stub?.say('paddle seven fifty', true, 0.87);
    await provider.stop();
    await rec.done;
    const ev = rec.events.filter((e) => e.type !== 'state');
    expect(ev[0]).toEqual({ type: 'interim', text: 'paddle', startMs: 100 });
    expect(ev[1]).toEqual({
      type: 'final',
      text: 'paddle seven fifty',
      words: [],
      startMs: 100,
      endMs: 400,
      confidence: 0.87,
      speechFinal: true,
    });
    expect(stub?.lang).toBe('en-US');
    expect(stub?.interimResults).toBe(true);
  });

  it('uses a fallback confidence when the browser reports none', async () => {
    const { stub, provider } = make();
    const rec = record(provider);
    await provider.start();
    stub?.say('fifty', true, 0);
    await provider.stop();
    await rec.done;
    const final = rec.events.find((e) => e.type === 'final');
    expect(final?.type === 'final' && final.confidence).toBe(WEBSPEECH_FALLBACK_CONFIDENCE);
  });

  it('carries the Try-it label and the webspeech evidence provider', async () => {
    const { provider } = make();
    expect(provider.name).toBe('webspeech');
    expect(provider.evidence).toEqual({ sttProvider: 'webspeech' });
    expect(WEBSPEECH_LABEL).toBe('Try-it mode, less accurate');
    expect(provider.statePayload()).toEqual({
      provider: 'webspeech',
      label: 'Try-it mode, less accurate',
      audioUploadedByThisCode: false,
      state: 'closed',
    });
    await provider.start();
    expect(provider.statePayload().state).toBe('open');
    expect(provider.statePayload().label).toBe(WEBSPEECH_LABEL);
    await provider.stop();
  });

  it('makes no network call and ignores audio batches', async () => {
    const fetchSpy = vi.fn();
    const socketSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('WebSocket', socketSpy);
    const { provider } = make();
    await provider.start();
    provider.write({ seq: 1, tsMs: 0, flags: 0, pcm: new Int16Array(FRAME_SAMPLES) });
    expect(provider.stats.counters.bytesIn).toBe(0);
    await provider.stop();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(socketSpy).not.toHaveBeenCalled();
  });

  it('restarts when the browser ends the session on its own', async () => {
    const { stub, provider } = make();
    await provider.start();
    stub?.onend?.();
    expect(stub?.starts).toBe(2);
    await provider.stop();
  });

  it('permission errors are not retryable and end the stream', async () => {
    const { stub, provider } = make();
    const rec = record(provider);
    await provider.start();
    stub?.onerror?.({ error: 'not-allowed' });
    stub?.onend?.();
    await rec.done;
    expect(stub?.starts).toBe(1);
    expect(rec.events).toContainEqual({ type: 'error', code: 'auth', retryable: false });
    expect(rec.events[rec.events.length - 1]).toEqual({ type: 'state', state: 'closed' });
  });

  it('no-speech is ignored and network is retryable', async () => {
    const { stub, provider } = make();
    const rec = record(provider);
    await provider.start();
    stub?.onerror?.({ error: 'no-speech' });
    stub?.onerror?.({ error: 'network' });
    await provider.stop();
    await rec.done;
    const errors = rec.events.filter((e) => e.type === 'error');
    expect(errors).toEqual([{ type: 'error', code: 'closed', retryable: true }]);
  });

  it('without a recognizer it reports an error and closes', async () => {
    const { provider } = make(null);
    const rec = record(provider);
    await provider.start();
    await rec.done;
    expect(rec.events.map((e) => e.type)).toEqual(['state', 'error', 'state']);
  });

  it('stop waits for the final result, falling back to a timer, and is idempotent', async () => {
    const stub = new StubRecognition();
    stub.endOnStop = false;
    const { clock, provider } = make(stub);
    const rec = record(provider);
    await provider.start();
    let stopped = false;
    const p = provider.stop().then(() => {
      stopped = true;
    });
    await flush();
    stub.say('bid one hundred', true, 0.8);
    expect(stopped).toBe(false);
    await clock.advance(1500);
    await p;
    await provider.stop();
    await rec.done;
    expect(rec.events.some((e) => e.type === 'final')).toBe(true);
    expect(rec.events[rec.events.length - 1]).toEqual({ type: 'state', state: 'closed' });
  });

  it('stop before start still ends with closed', async () => {
    const { provider } = make();
    const rec = record(provider);
    await provider.stop();
    await rec.done;
    expect(rec.events).toEqual([{ type: 'state', state: 'closed' }]);
  });
});
