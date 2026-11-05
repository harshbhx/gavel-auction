import { describe, expect, it } from 'vitest';
import { FRAME_SAMPLES, type AudioBatch } from '../../src/audio/frame.js';
import { FailoverStt, type SwitchReason } from '../../src/stt/failover.js';
import { FakeStt, VirtualClock, type ScriptStep } from '../../src/stt/fake.js';
import type { SttEvent } from '../../src/stt/provider.js';
import { runConformance } from './conformance.js';

function batch(seq: number): AudioBatch {
  return { seq, tsMs: seq * 100, flags: 0, pcm: new Int16Array(5 * FRAME_SAMPLES) };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

const interim = (atMs: number): ScriptStep => ({
  atMs,
  event: { type: 'interim', text: 'three', startMs: 0 },
});

const final = (atMs: number, endMs: number): ScriptStep => ({
  atMs,
  event: {
    type: 'final',
    text: 'three fifty',
    words: [],
    startMs: 0,
    endMs,
    confidence: 0.9,
    speechFinal: true,
  },
});

interface Rig {
  clock: VirtualClock;
  stt: FailoverStt;
  primaries: FakeStt[];
  fallbacks: FakeStt[];
  switches: SwitchReason[];
  seen: SttEvent[];
  /** Write n batches, advancing 100 ms after each. */
  feed(n: number): Promise<void>;
}

function rig(primaryScripts: ScriptStep[][]): Rig {
  const clock = new VirtualClock();
  const primaries: FakeStt[] = [];
  const fallbacks: FakeStt[] = [];
  const switches: SwitchReason[] = [];
  const stt = new FailoverStt({
    clock,
    primary: () => {
      const p = new FakeStt({ clock, script: primaryScripts[primaries.length] ?? [] });
      primaries.push(p);
      return p;
    },
    fallback: () => {
      const f = new FakeStt({ clock });
      fallbacks.push(f);
      return f;
    },
    onSwitch: (i) => switches.push(i.reason),
  });
  const seen: SttEvent[] = [];
  void (async () => {
    for await (const e of stt.events()) seen.push(e);
  })();
  let seq = 0;
  return {
    clock,
    stt,
    primaries,
    fallbacks,
    switches,
    seen,
    feed: async (n) => {
      for (let i = 0; i < n; i++) {
        stt.write(batch(seq++));
        clock.advance(100);
        await flush();
      }
    },
  };
}

runConformance('FailoverStt', () => {
  const clock = new VirtualClock();
  return {
    provider: new FailoverStt({
      clock,
      primary: () => new FakeStt({ clock, processMsPerBatch: 20 }),
      fallback: () => new FakeStt({ clock, processMsPerBatch: 20 }),
    }),
    advance: (ms) => {
      clock.advance(ms);
      return Promise.resolve();
    },
  };
});

describe('T-VOX-019 failover triggers', () => {
  it('(a) primary silent for 3000 ms of audio switches and replays the last 5 s', async () => {
    const r = rig([[]]);
    await r.stt.start({ keyterms: [], language: 'en' });
    await r.feed(29);
    expect(r.switches).toEqual([]);
    await r.feed(1);
    await flush();
    expect(r.switches).toEqual(['silent']);
    expect(r.fallbacks).toHaveLength(1);
    expect(r.fallbacks[0]?.processedBatches).toBe(30);
    await r.stt.stop();
  });

  it('replay is capped at 5 s of audio', async () => {
    const r = rig([[interim(100), final(6000, 1000)]]);
    await r.stt.start({ keyterms: [], language: 'en' });
    await r.feed(60);
    await flush();
    expect(r.switches).toEqual(['late_final']);
    expect(r.fallbacks[0]?.processedBatches).toBe(50);
    await r.stt.stop();
  });

  it('(b) a non-retryable error switches immediately', async () => {
    const r = rig([[interim(100)]]);
    await r.stt.start({ keyterms: [], language: 'en' });
    await r.feed(3);
    r.primaries[0]?.injectError('auth', false);
    await flush();
    expect(r.switches).toEqual(['fatal']);
    expect(r.stt.usingPrimary).toBe(false);
    await r.stt.stop();
  });

  it('(c) two consecutive retryable errors switch, one does not, a result in between resets', async () => {
    const r = rig([[interim(100), interim(300)]]);
    await r.stt.start({ keyterms: [], language: 'en' });
    await r.feed(1);
    r.primaries[0]?.injectError('rate_limited', true);
    await flush();
    expect(r.switches).toEqual([]);
    await r.feed(3);
    r.primaries[0]?.injectError('timeout', true);
    await flush();
    expect(r.switches).toEqual([]);
    r.primaries[0]?.injectError('timeout', true);
    await flush();
    expect(r.switches).toEqual(['errors']);
    await r.stt.stop();
  });

  it('(d) a final later than 4000 ms after speech end switches; 4000 exactly does not', async () => {
    const ok = rig([[interim(100), final(5000, 1000)]]);
    await ok.stt.start({ keyterms: [], language: 'en' });
    await ok.feed(51);
    expect(ok.switches).toEqual([]);
    await ok.stt.stop();

    const late = rig([[interim(100), final(5100, 1000)]]);
    await late.stt.start({ keyterms: [], language: 'en' });
    await late.feed(52);
    expect(late.switches).toEqual(['late_final']);
    expect(late.seen.some((e) => e.type === 'final')).toBe(true);
    await late.stt.stop();
  });

  it('opens a circuit for 30 s, probes the primary, and returns on a healthy probe', async () => {
    const r = rig([[], [interim(200)]]);
    await r.stt.start({ keyterms: [], language: 'en' });
    await r.feed(30);
    expect(r.switches).toEqual(['silent']);
    // Circuit is open until 3000 + 30000; no probe before that.
    await r.feed(299);
    expect(r.primaries).toHaveLength(1);
    await r.feed(2);
    expect(r.primaries).toHaveLength(2);
    expect(r.stt.usingPrimary).toBe(false);
    await r.feed(3);
    await flush();
    expect(r.stt.usingPrimary).toBe(true);
    expect(r.switches).toEqual(['silent', 'recovered']);
    expect(r.seen.filter((e) => e.type === 'interim')).toHaveLength(1);
    await r.stt.stop();
  });

  it('a failed probe re-opens the circuit', async () => {
    const r = rig([[], []]);
    await r.stt.start({ keyterms: [], language: 'en' });
    await r.feed(30);
    await r.feed(301);
    expect(r.primaries).toHaveLength(2);
    r.primaries[1]?.injectError('auth', false);
    await flush();
    expect(r.stt.usingPrimary).toBe(false);
    await r.feed(100);
    expect(r.primaries).toHaveLength(2);
    await r.stt.stop();
  });

  it('events from a replaced provider never reach the consumer as a close', async () => {
    const r = rig([[interim(100)]]);
    await r.stt.start({ keyterms: [], language: 'en' });
    await r.feed(2);
    r.primaries[0]?.injectError('auth', false);
    await flush();
    const closedBeforeStop = r.seen.filter((e) => e.type === 'state' && e.state === 'closed');
    expect(closedBeforeStop).toHaveLength(0);
    await r.stt.stop();
    await flush();
    expect(r.seen[r.seen.length - 1]).toEqual({ type: 'state', state: 'closed' });
  });
});
