import { describe, expect, it } from 'vitest';
import {
  FLAG_END_OF_STREAM,
  FLAG_KEEPALIVE,
  FRAME_SAMPLES,
  type AudioBatch,
} from '../../src/audio/frame.js';
import {
  DeepgramStt,
  mapDeepgramMessage,
  type DeepgramSttOptions,
} from '../../src/stt/deepgram.js';
import { buildDeepgramUrl, mergeDeepgramConfig } from '../../src/stt/deepgram-config.js';
import { runConformance } from './conformance.js';
import { FakeScheduler, flush, mockFactory, record, type MockWsOptions } from './deepgram-mock.js';

function audio(seq: number, flags = 0): AudioBatch {
  return { seq, tsMs: seq * 100, flags, pcm: new Int16Array(FRAME_SAMPLES) };
}

function make(extra: Partial<DeepgramSttOptions> = {}, mock: MockWsOptions = {}) {
  const clock = new FakeScheduler();
  const { factory, sockets } = mockFactory(mock);
  const provider = new DeepgramStt({
    apiKey: 'test-key-not-real',
    socket: factory,
    scheduler: clock,
    ...extra,
  });
  return { clock, sockets, provider };
}

const START = { keyterms: [], language: 'en' as const };

runConformance('DeepgramStt', () => {
  const { clock, provider } = make();
  return { provider, advance: (ms) => clock.advance(ms) };
});

describe('DeepgramStt handshake (T-VOX-014)', () => {
  it('puts the documented parameters in the URL query', async () => {
    const { provider, sockets } = make();
    await provider.start(START);
    const url = new URL(sockets[0]?.url ?? '');
    expect(url.origin).toBe('wss://api.deepgram.com');
    const q = url.searchParams;
    expect(q.get('model')).toBe('nova-3');
    expect(q.get('encoding')).toBe('linear16');
    expect(q.get('sample_rate')).toBe('16000');
    expect(q.get('channels')).toBe('1');
    expect(q.get('interim_results')).toBe('true');
    expect(q.get('endpointing')).toBe('300');
    expect(q.get('utterance_end_ms')).toBe('1000');
    expect(q.get('language')).toBe('en');
    expect(sockets[0]?.protocols).toEqual(['token', 'test-key-not-real']);
    await provider.stop();
  });

  it('a config override changes the URL without code edits', async () => {
    const { provider, sockets } = make({
      config: { url: 'wss://example.invalid/listen', params: { model: 'other', endpointing: 500 } },
    });
    await provider.start(START);
    const url = new URL(sockets[0]?.url ?? '');
    expect(url.host).toBe('example.invalid');
    expect(url.searchParams.get('model')).toBe('other');
    expect(url.searchParams.get('endpointing')).toBe('500');
    expect(url.searchParams.get('encoding')).toBe('linear16');
    await provider.stop();
  });

  it('buildDeepgramUrl appends repeated extras after the configured params', () => {
    const cfg = mergeDeepgramConfig({ params: { language: 'en' } });
    const u = new URL(
      buildDeepgramUrl(cfg, [
        ['x', '1'],
        ['x', '2'],
      ]),
    );
    expect(u.searchParams.getAll('x')).toEqual(['1', '2']);
  });
});

describe('DeepgramStt keepalive and close (T-VOX-016)', () => {
  it('sends KeepAlive at 5 s and 10 s when idle for 12 s', async () => {
    const { provider, sockets, clock } = make();
    await provider.start(START);
    await clock.advance(12000);
    expect(sockets[0]?.texts).toEqual(['{"type":"KeepAlive"}', '{"type":"KeepAlive"}']);
    await provider.stop();
  });

  it('does not send KeepAlive while audio is flowing', async () => {
    const { provider, sockets, clock } = make();
    await provider.start(START);
    for (let i = 0; i < 12; i++) {
      provider.write(audio(i));
      await clock.advance(1000);
    }
    expect(sockets[0]?.texts).toEqual([]);
    expect(sockets[0]?.binaries).toHaveLength(12);
    expect(sockets[0]?.binaries[0]?.length).toBe(FRAME_SAMPLES * 2);
    await provider.stop();
  });

  it('keepalive batches from capture are not forwarded as audio', async () => {
    const { provider, sockets } = make();
    await provider.start(START);
    provider.write({ seq: 1, tsMs: 0, flags: FLAG_KEEPALIVE, pcm: new Int16Array(0) });
    expect(sockets[0]?.sent).toHaveLength(0);
    await provider.stop();
  });

  it('end of stream sends the finalize message after the audio', async () => {
    const { provider, sockets } = make();
    await provider.start(START);
    provider.write(audio(1, FLAG_END_OF_STREAM));
    expect(sockets[0]?.texts).toEqual(['{"type":"Finalize"}']);
    await provider.stop();
  });

  it('stop sends CloseStream, then closes the socket and ends with closed', async () => {
    const { provider, sockets } = make();
    const rec = record(provider);
    await provider.start(START);
    await provider.stop();
    await rec.done;
    expect(sockets[0]?.texts).toEqual(['{"type":"CloseStream"}']);
    expect(sockets[0]?.closed).toBe(true);
    expect(rec.events[rec.events.length - 1]).toEqual({ type: 'state', state: 'closed' });
  });

  it('stop closes after closeWaitMs when the server stays silent, and keeps late finals', async () => {
    const { provider, sockets, clock } = make({}, { closeOnCloseStream: false });
    const rec = record(provider);
    await provider.start(START);
    let stopped = false;
    const p = provider.stop().then(() => {
      stopped = true;
    });
    await flush();
    sockets[0]?.message({
      type: 'Results',
      is_final: true,
      start: 0,
      duration: 1,
      channel: { alternatives: [{ transcript: 'bid fifty', confidence: 0.9, words: [] }] },
    });
    expect(stopped).toBe(false);
    await clock.advance(2000);
    await p;
    await rec.done;
    expect(stopped).toBe(true);
    expect(sockets[0]?.closed).toBe(true);
    expect(rec.events.some((e) => e.type === 'final')).toBe(true);
  });
});

describe('DeepgramStt message mapping', () => {
  it('maps interim and final results with word confidences', async () => {
    const { provider, sockets } = make();
    const rec = record(provider);
    await provider.start(START);
    const ws = sockets[0];
    ws?.message({
      type: 'Results',
      is_final: false,
      start: 1.5,
      duration: 0.5,
      channel: { alternatives: [{ transcript: 'fifty', confidence: 0.8 }] },
    });
    ws?.message({
      type: 'Results',
      is_final: true,
      speech_final: true,
      start: 1.5,
      duration: 1.25,
      channel: {
        alternatives: [
          {
            transcript: 'fifty dollars',
            confidence: 0.93,
            words: [
              { word: 'fifty', start: 1.5, end: 1.9, confidence: 0.95 },
              { word: 'dollars', start: 1.95, end: 2.75, confidence: 0.91 },
            ],
          },
        ],
      },
    });
    ws?.message({ type: 'UtteranceEnd', last_word_end: 2.75 });
    await provider.stop();
    await rec.done;
    const ev = rec.events.filter((e) => e.type !== 'state');
    expect(ev[0]).toEqual({ type: 'interim', text: 'fifty', startMs: 1500 });
    expect(ev[1]).toEqual({
      type: 'final',
      text: 'fifty dollars',
      words: [
        { word: 'fifty', start: 1.5, end: 1.9, confidence: 0.95 },
        { word: 'dollars', start: 1.95, end: 2.75, confidence: 0.91 },
      ],
      startMs: 1500,
      endMs: 2750,
      confidence: 0.93,
      speechFinal: true,
    });
    expect(ev[2]).toEqual({ type: 'utterance_end', atMs: 2750 });
    expect(provider.stats.counters.finals).toBe(1);
    expect(provider.stats.counters.interims).toBe(1);
  });

  it('ignores empty transcripts, metadata, malformed and binary messages', () => {
    expect(mapDeepgramMessage('not json')).toBeNull();
    expect(mapDeepgramMessage('[]')).toBeNull();
    expect(mapDeepgramMessage(new Uint8Array(4))).toBeNull();
    expect(mapDeepgramMessage('{"type":"Metadata"}')).toBeNull();
    expect(
      mapDeepgramMessage(
        '{"type":"Results","is_final":true,"channel":{"alternatives":[{"transcript":"  "}]}}',
      ),
    ).toBeNull();
  });
});

describe('DeepgramStt failures and back-pressure', () => {
  it('drops a batch and counts it when the send buffer is full', async () => {
    const { provider, sockets } = make({ config: { maxBufferedBytes: 1000 } });
    await provider.start(START);
    const ws = sockets[0];
    if (ws) ws.bufferedAmount = 5000;
    provider.write(audio(1));
    expect(ws?.binaries).toHaveLength(0);
    expect(provider.stats.counters.droppedBatches).toBe(1);
    if (ws) ws.bufferedAmount = 0;
    provider.write(audio(2));
    expect(ws?.binaries).toHaveLength(1);
    await provider.stop();
  });

  it('an unexpected close emits a retryable error, then closed', async () => {
    const { provider, sockets } = make();
    const rec = record(provider);
    await provider.start(START);
    sockets[0]?.serverClose(1006);
    await rec.done;
    expect(rec.events.slice(-2)).toEqual([
      { type: 'error', code: 'closed', retryable: true },
      { type: 'state', state: 'closed' },
    ]);
  });

  it('an auth close code is not retryable', async () => {
    const { provider, sockets } = make();
    const rec = record(provider);
    await provider.start(START);
    sockets[0]?.serverClose(1008);
    await rec.done;
    expect(rec.events).toContainEqual({ type: 'error', code: 'auth', retryable: false });
  });

  it('a socket that never opens ends with a timeout error after openTimeoutMs', async () => {
    const { provider, clock } = make({}, { autoOpen: false });
    const rec = record(provider);
    const started = provider.start(START);
    await clock.advance(5000);
    await started;
    await rec.done;
    expect(rec.events).toEqual([
      { type: 'state', state: 'connecting' },
      { type: 'error', code: 'timeout', retryable: true },
      { type: 'state', state: 'closed' },
    ]);
  });

  it('a factory that throws ends the stream with an error', async () => {
    const provider = new DeepgramStt({
      apiKey: 'k',
      socket: () => {
        throw new Error('no network');
      },
      scheduler: new FakeScheduler(),
    });
    const rec = record(provider);
    await provider.start(START);
    await rec.done;
    expect(rec.events.map((e) => e.type)).toEqual(['state', 'error', 'state']);
  });
});
