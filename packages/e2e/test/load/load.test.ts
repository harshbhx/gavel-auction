import { describe, expect, it } from 'vitest';
import { LatencyHistogram, TimedTransport } from '../../src/load/clients';
import { LIMITS, runL1, runL2, type LoadDeps } from '../../src/load/run';

// T-QA-060 (L1) and T-QA-061 (L2). The run uses a fixed clock and a fixed RSS so the test is
// deterministic; the latency and memory limits are exercised by the real run (run.ts main).
const deps: LoadDeps = { now: () => 0, rss: () => 0 };

describe('load harness helpers', () => {
  it('computes nearest rank percentiles', () => {
    const h = new LatencyHistogram();
    for (let i = 1; i <= 100; i += 1) h.record(i);
    expect(h.percentile(50)).toBe(50);
    expect(h.percentile(95)).toBe(95);
    expect(h.percentile(99)).toBe(99);
    expect(h.percentile(100)).toBe(100);
    expect(h.toJSON().buckets.at(-1)).toEqual({ leMs: 'inf', count: 100 });
  });

  it('records bid replies by message id and counts other frames apart', () => {
    let t = 0;
    const transport = new TimedTransport(() => (t += 5));
    transport.send(JSON.stringify({ v: 1, t: 'bid_accepted', mid: 'm1' }));
    transport.send(JSON.stringify({ v: 1, t: 'bid_rejected', mid: 'm1' }));
    transport.send(JSON.stringify({ v: 1, t: 'price', seq: 1 }));
    transport.send('not json');
    expect(transport.replies.get('m1')?.map((r) => r.type)).toEqual([
      'bid_accepted',
      'bid_rejected',
    ]);
    expect(transport.other).toBe(2);
  });

  it('keeps the documented limits', () => {
    expect(LIMITS).toEqual({ p95AckMs: 250, p99AckMs: 600, rssGrowthMb: 150 });
  });
});

describe('T-QA-060 L1: 100 bidders', () => {
  it('answers every bid exactly once', async () => {
    const r = await runL1(deps);
    expect(r.bidders).toBe(100);
    expect(r.sent).toBe(300);
    expect(r.lost).toBe(0);
    expect(r.duplicate).toBe(0);
    expect(r.accepted + r.rejected).toBe(300);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.ok).toBe(true);
  }, 180_000);
});

describe('T-QA-061 L2: identical bid race', () => {
  it('accepts exactly one of 100 identical bids', async () => {
    const r = await runL2(deps);
    expect(r.sent).toBe(100);
    expect(r.accepted).toBe(1);
    expect(r.rejected).toBe(99);
    expect(r.lost).toBe(0);
    expect(r.duplicate).toBe(0);
    expect(r.ok).toBe(true);
  }, 180_000);
});
