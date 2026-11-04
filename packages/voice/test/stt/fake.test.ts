import { describe, expect, it } from 'vitest';
import { FRAME_SAMPLES, type AudioBatch } from '../../src/audio/frame.js';
import { FakeStt, VirtualClock, type ScriptStep } from '../../src/stt/fake.js';
import { LatencyHistogram, type SttEvent } from '../../src/stt/provider.js';
import { runConformance } from './conformance.js';

function final(text: string, startMs: number, endMs: number): SttEvent {
  return { type: 'final', text, words: [], startMs, endMs, confidence: 0.9, speechFinal: true };
}

function batch(seq: number): AudioBatch {
  return { seq, tsMs: seq * 100, flags: 0, pcm: new Int16Array(5 * FRAME_SAMPLES) };
}

/** Reads events into a list stamped with the virtual time at which they arrived. */
function tap(stt: FakeStt, clock: VirtualClock): Array<{ at: number; event: SttEvent }> {
  const seen: Array<{ at: number; event: SttEvent }> = [];
  void (async () => {
    for await (const event of stt.events()) seen.push({ at: clock.now(), event });
  })();
  return seen;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

runConformance('FakeStt', () => {
  const clock = new VirtualClock();
  return {
    provider: new FakeStt({ clock, processMsPerBatch: 20, capacity: 50 }),
    advance: (ms) => {
      clock.advance(ms);
      return Promise.resolve();
    },
  };
});

describe('T-VOX-025 scripted replay on a virtual clock', () => {
  it('delivers events at their scheduled times in order', async () => {
    const clock = new VirtualClock();
    const script: ScriptStep[] = [
      { atMs: 100, event: { type: 'interim', text: 'three', startMs: 0 } },
      { atMs: 500, event: final('three hundred', 0, 450) },
      { atMs: 900, event: { type: 'error', code: 'timeout', retryable: true } },
      { atMs: 1000, event: final('three hundred', 0, 450), fault: { kind: 'duplicate' } },
    ];
    const stt = new FakeStt({ clock, script });
    await stt.start({ keyterms: [], language: 'en' });
    const seen = tap(stt, clock);
    for (let t = 0; t < 1200; t += 50) {
      clock.advance(50);
      await flush();
    }
    const timeline = seen.filter((s) => s.event.type !== 'state').map((s) => [s.at, s.event.type]);
    expect(timeline).toEqual([
      [100, 'interim'],
      [500, 'final'],
      [900, 'error'],
      [1000, 'final'],
      [1000, 'final'],
    ]);
  });

  it('honours drop and delay faults', async () => {
    const clock = new VirtualClock();
    const stt = new FakeStt({
      clock,
      script: [
        { atMs: 100, event: final('dropped', 0, 80), fault: { kind: 'drop' } },
        { atMs: 200, event: final('late', 0, 150), fault: { kind: 'delay', ms: 300 } },
        { atMs: 300, event: final('on time', 0, 250) },
      ],
    });
    await stt.start({ keyterms: [], language: 'en' });
    const seen = tap(stt, clock);
    for (let t = 0; t < 600; t += 50) {
      clock.advance(50);
      await flush();
    }
    const finals = seen
      .filter((s) => s.event.type === 'final')
      .map((s) => [s.at, s.event.type === 'final' ? s.event.text : '']);
    expect(finals).toEqual([
      [300, 'on time'],
      [500, 'late'],
    ]);
  });

  it('injectError emits immediately', async () => {
    const clock = new VirtualClock();
    const stt = new FakeStt({ clock });
    await stt.start({ keyterms: [], language: 'en' });
    const seen = tap(stt, clock);
    stt.injectError('auth', false);
    await flush();
    expect(seen.some((s) => s.event.type === 'error' && s.event.code === 'auth')).toBe(true);
  });
});

describe('T-VOX-026 counters and latency histogram', () => {
  it('counts a scripted session and records speech-end to final latency', async () => {
    const clock = new VirtualClock();
    const stt = new FakeStt({
      clock,
      script: [
        { atMs: 100, event: { type: 'interim', text: 'two', startMs: 0 } },
        { atMs: 200, event: { type: 'interim', text: 'two fifty', startMs: 0 } },
        { atMs: 600, event: final('two fifty', 0, 400) },
        { atMs: 900, event: { type: 'error', code: 'unknown', retryable: true } },
        { atMs: 1000, event: { type: 'state', state: 'reconnecting' } },
        {
          atMs: 1500,
          event: final('three hundred', 1100, 1200),
          fault: { kind: 'delay', ms: 700 },
        },
      ],
    });
    await stt.start({ keyterms: [], language: 'en' });
    stt.write(batch(1));
    stt.write(batch(2));
    clock.advance(3000);
    const c = stt.stats.counters;
    expect(c).toEqual({
      bytesIn: 2 * 5 * FRAME_SAMPLES * 2,
      finals: 2,
      interims: 2,
      errors: 1,
      reconnects: 1,
      droppedBatches: 0,
    });
    // latencies: 600-400 = 200 and (1500+700)-1200 = 1000
    expect(stt.stats.latency.count).toBe(2);
    expect(stt.stats.latency.max).toBe(1000);
    expect(stt.stats.latency.percentile(0.5)).toBe(250);
    expect(stt.stats.latency.percentile(1)).toBe(1000);
    await stt.stop();
  });
});

describe('R-VOX-013 overload', () => {
  it('drops the oldest batches beyond capacity and marks a discontinuity', async () => {
    const clock = new VirtualClock();
    const stt = new FakeStt({ clock, capacity: 10, processMsPerBatch: 100 });
    await stt.start({ keyterms: [], language: 'en' });
    for (let i = 0; i < 1000; i++) stt.write(batch(i));
    expect(stt.stats.counters.droppedBatches).toBe(990);
    expect(stt.discontinuity).toBe(true);
    clock.advance(10_000);
    expect(stt.processedBatches).toBe(10);
    await stt.stop();
  });

  it('bounds undelivered events when nobody reads', async () => {
    const clock = new VirtualClock();
    const script: ScriptStep[] = [];
    for (let i = 0; i < 100; i++)
      script.push({ atMs: i, event: { type: 'interim', text: 'x', startMs: 0 } });
    const stt = new FakeStt({ clock, script, maxBufferedEvents: 16 });
    await stt.start({ keyterms: [], language: 'en' });
    clock.advance(200);
    expect(stt.droppedEvents).toBeGreaterThan(0);
    await stt.stop();
  });
});

describe('LatencyHistogram', () => {
  it('buckets values and reports percentiles', () => {
    const h = new LatencyHistogram([100, 500]);
    [50, 100, 300, 900].forEach((v) => h.record(v));
    expect(h.snapshot()).toEqual([
      { le: 100, count: 2 },
      { le: 500, count: 1 },
      { le: Number.POSITIVE_INFINITY, count: 1 },
    ]);
    expect(h.percentile(0.5)).toBe(100);
    expect(h.percentile(1)).toBe(900);
    expect(h.mean).toBe(337.5);
  });
});
