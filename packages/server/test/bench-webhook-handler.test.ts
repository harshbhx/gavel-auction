import { describe, expect, it } from 'vitest';
import { buildReport, nearestRank, runWebhookBench } from '../bench/webhook-handler';

describe('webhook handler bench (issue 2191)', () => {
  it('computes nearest-rank percentiles', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(nearestRank(xs, 50)).toBe(50);
    expect(nearestRank(xs, 95)).toBe(95);
    expect(nearestRank(xs, 99)).toBe(99);
    expect(nearestRank([], 95)).toBe(0);
  });

  it('judges the p95 against 300 ms and refuses non-200 answers', () => {
    expect(buildReport([10, 20, 30], { '200': 3 }).verdict).toBe('MET');
    expect(buildReport([10, 20, 400], { '200': 3 }).verdict).toBe('MISSED');
    expect(buildReport([10, 20, 30], { '200': 2, '503': 1 }).verdict).toBe('INVALID');
    expect(buildReport([], {}).verdict).toBe('INVALID');
    const r = buildReport([1.234, 2], { '200': 2 });
    expect(r.n).toBe(2);
    expect(r.maxMs).toBe(2);
  });

  it('runs against the composed server: every ignored-type delivery is answered 200', async () => {
    const r = await runWebhookBench({ n: 25 });
    expect(r.statusCounts).toEqual({ '200': 25 });
    expect(r.n).toBe(25);
    expect(r.verdict).not.toBe('INVALID');
    expect(r.p50Ms).toBeLessThanOrEqual(r.p95Ms);
    expect(r.p95Ms).toBeLessThanOrEqual(r.maxMs);
  }, 60_000);
});
