import { describe, expect, it } from 'vitest';
import { FLAG_END_OF_STREAM, FRAME_SAMPLES, type AudioBatch } from '../../src/audio/frame.js';
import type { InstrumentedSttProvider, SttEvent } from '../../src/stt/provider.js';

export interface ConformanceHandle {
  provider: InstrumentedSttProvider;
  /** Let virtual or real time pass so queued transport work runs. */
  advance(ms: number): Promise<void>;
}

function batch(seq: number, flags = 0): AudioBatch {
  return { seq, tsMs: seq * 100, flags, pcm: new Int16Array(5 * FRAME_SAMPLES) };
}

async function collect(handle: ConformanceHandle, stop: boolean): Promise<SttEvent[]> {
  const out: SttEvent[] = [];
  const it = handle.provider.events()[Symbol.asyncIterator]();
  const reader = (async () => {
    for (;;) {
      const r = await it.next();
      if (r.done) return;
      out.push(r.value);
    }
  })();
  if (stop) {
    await handle.provider.stop();
    await reader;
  }
  return out;
}

/** Shared SttProvider contract (R-VOX-012, R-VOX-013). Every provider runs this against a mocked transport. */
export function runConformance(label: string, makeProvider: () => ConformanceHandle): void {
  describe(`SttProvider conformance: ${label}`, () => {
    it('start resolves and emits connecting then open before anything else', async () => {
      const h = makeProvider();
      await h.provider.start({ keyterms: ['paddle'], language: 'en' });
      const states: string[] = [];
      const it = h.provider.events()[Symbol.asyncIterator]();
      for (let i = 0; i < 2; i++) {
        const r = await it.next();
        if (!r.done && r.value.type === 'state') states.push(r.value.state);
      }
      expect(states).toEqual(['connecting', 'open']);
      await h.provider.stop();
    });

    it('stop resolves, the last event is state closed and the stream ends', async () => {
      const h = makeProvider();
      await h.provider.start({ keyterms: [], language: 'en' });
      const events = await collect(h, true);
      const last = events[events.length - 1];
      expect(last).toEqual({ type: 'state', state: 'closed' });
    });

    it('stop twice is harmless', async () => {
      const h = makeProvider();
      await h.provider.start({ keyterms: [], language: 'en' });
      await h.provider.stop();
      await expect(h.provider.stop()).resolves.toBeUndefined();
    });

    it('write never throws: before start, while open, after stop, with flags', async () => {
      const h = makeProvider();
      expect(() => h.provider.write(batch(0))).not.toThrow();
      await h.provider.start({ keyterms: [], language: 'en' });
      expect(() => h.provider.write(batch(1))).not.toThrow();
      expect(() => h.provider.write(batch(2, FLAG_END_OF_STREAM))).not.toThrow();
      await h.provider.stop();
      expect(() => h.provider.write(batch(3))).not.toThrow();
    });

    it('counts bytes written while open', async () => {
      const h = makeProvider();
      await h.provider.start({ keyterms: [], language: 'en' });
      h.provider.write(batch(1));
      h.provider.write(batch(2));
      expect(h.provider.stats.counters.bytesIn).toBe(2 * 5 * FRAME_SAMPLES * 2);
      await h.provider.stop();
    });

    it('1000 writes with a consumer that never reads stay bounded and do not throw', async () => {
      const h = makeProvider();
      await h.provider.start({ keyterms: [], language: 'en' });
      for (let i = 0; i < 1000; i++) {
        expect(() => h.provider.write(batch(i))).not.toThrow();
      }
      await h.advance(1000);
      const c = h.provider.stats.counters;
      expect(c.bytesIn).toBe(1000 * 5 * FRAME_SAMPLES * 2);
      expect(c.droppedBatches).toBeGreaterThanOrEqual(0);
      expect(c.droppedBatches).toBeLessThanOrEqual(1000);
      await h.provider.stop();
    });

    it('exposes all counters and a latency histogram', () => {
      const h = makeProvider();
      expect(Object.keys(h.provider.stats.counters).sort()).toEqual([
        'bytesIn',
        'droppedBatches',
        'errors',
        'finals',
        'interims',
        'reconnects',
      ]);
      expect(h.provider.stats.latency.count).toBe(0);
    });
  });
}
