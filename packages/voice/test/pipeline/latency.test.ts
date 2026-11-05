import { describe, expect, it } from 'vitest';
import {
  BUDGET_TOTAL_MS,
  budgetCheck,
  latencyOf,
  percentile,
  type LatencySample,
} from '../../src/pipeline/latency.js';

function samples(latencies: number[]): LatencySample[] {
  return latencies.map((l) => ({ speechEndMs: 1000, decisionMs: 1000 + l }));
}

describe('latency budget', () => {
  it('component budget adds up to 1200 ms', () => {
    expect(BUDGET_TOTAL_MS).toBe(1200);
  });

  it('computes nearest-rank percentiles', () => {
    const v = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(percentile(v, 50)).toBe(500);
    expect(percentile(v, 95)).toBe(1000);
    expect(percentile([], 50)).toBe(0);
  });

  it('measures speech end to decision and never goes negative', () => {
    expect(latencyOf({ speechEndMs: 1000, decisionMs: 1900 })).toBe(900);
    expect(latencyOf({ speechEndMs: 1000, decisionMs: 900 })).toBe(0);
  });

  it('T-VOX-109: passes inside 1200 / 2000 and fails outside', () => {
    const ok = budgetCheck(samples([800, 900, 1000, 1100, 1200, 1300, 1500, 1800, 1900, 2000]));
    expect(ok.p50).toBe(1200);
    expect(ok.p95).toBe(2000);
    expect(ok.pass).toBe(true);

    const slowMedian = budgetCheck(samples([1300, 1300, 1300, 1300, 1300]));
    expect(slowMedian.p50Pass).toBe(false);
    expect(slowMedian.pass).toBe(false);

    const slowTail = budgetCheck(samples([500, 500, 500, 500, 500, 500, 500, 500, 500, 2500]));
    expect(slowTail.p50Pass).toBe(true);
    expect(slowTail.p95Pass).toBe(false);
    expect(slowTail.pass).toBe(false);
  });

  it('uses 700 ms p50 when rules only and fails with no samples', () => {
    const s = samples([800, 800, 800]);
    expect(budgetCheck(s, 'model').pass).toBe(true);
    expect(budgetCheck(s, 'rules_only').pass).toBe(false);
    expect(budgetCheck([]).pass).toBe(false);
  });
});
