import { describe, expect, it } from 'vitest';
import { sizeCounters, startDiagnostics, summarize, takeSample } from '../../src/load/diag';

describe('load diagnostics (#2203)', () => {
  it('counts maps, sets and arrays below a root, and the inner size of a map of arrays', () => {
    class Holder {
      readonly logs = new Map<string, number[]>([
        ['a', [1, 2]],
        ['b', [3]],
      ]);
      readonly seen = new Set(['x']);
      readonly list = [1, 2, 3, 4];
      readonly nested = { deep: new Map([['k', 1]]) };
    }
    expect(sizeCounters(new Holder(), 'h')).toEqual({
      'h.logs': 2,
      'h.logs.values': 3,
      'h.seen': 1,
      'h.list': 4,
      'h.nested.deep': 1,
    });
  });

  it('skips cycles', () => {
    const a: Record<string, unknown> = { list: [1] };
    a['self'] = a;
    expect(sizeCounters(a, 'a')).toEqual({ 'a.list': 1 });
  });

  it('takes a sample with memory figures, a live heap after gc and the probe counters', () => {
    let collected = 0;
    const s = takeSample(
      {
        probe: () => ({ rows: 7 }),
        gc: () => {
          collected += 1;
        },
      },
      0,
    );
    expect(collected).toBe(1);
    expect(s.rssMb).toBeGreaterThan(0);
    expect(s.liveHeapMb).not.toBeNull();
    expect(s.counters).toEqual({ rows: 7 });
  });

  it('summarises growth, largest counter first', () => {
    const base = { atMs: 0, rssMb: 100, heapUsedMb: 50, externalMb: 1, arrayBuffersMb: 0 };
    const mk = (rssMb: number, live: number, counters: Record<string, number>) => ({
      ...base,
      rssMb,
      heapSizeLimitMb: 4000,
      liveHeapMb: live,
      resources: {},
      spaces: {},
      counters,
    });
    const sum = summarize([mk(100, 40, { a: 1, b: 5 }), mk(160, 90, { a: 11, b: 5 })]);
    expect(sum.rssGrowthMb).toBe(60);
    expect(sum.liveHeapGrowthMb).toBe(50);
    expect(sum.counterGrowth[0]).toEqual({ name: 'a', first: 1, last: 11, delta: 10 });
  });

  it('keeps sampling until finished and then stops', async () => {
    const d = startDiagnostics({ intervalMs: 5, probe: () => ({ n: 1 }) });
    await new Promise((r) => setTimeout(r, 40));
    const sum = d.finish();
    const n = sum.samples.length;
    expect(n).toBeGreaterThanOrEqual(3);
    await new Promise((r) => setTimeout(r, 30));
    expect(d.samples.length).toBe(n);
  });
});
