import { describe, expect, it } from 'vitest';
import { runL3 } from '../../src/load/hammer';
import { runL4 } from '../../src/load/webhooks';
import { runSoak } from '../../src/load/soak';

// T-QA-062 (L3), T-QA-063 (L4) and T-QA-064 (L5), scaled down for CI. The full runs use
// src/load/cli.ts: 500 hammer iterations, 50 duplicate webhooks and a 30 minute soak.

describe('T-QA-062 L3 hammer race', () => {
  it('lets exactly one bid win every race', async () => {
    const r = await runL3({ now: () => 0, rss: () => 0, iterations: 12, bidders: 5 });
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.violations).toBe(0);
    expect(r.ok).toBe(true);
  }, 120_000);
});

describe('T-QA-063 L4 webhook storm', () => {
  it('stores one event for 50 duplicate deliveries', async () => {
    const r = await runL4(50);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.stored).toBe(1);
    expect(r.ok).toBe(true);
  }, 120_000);
});

describe('T-QA-064 L5 soak', () => {
  it('keeps the invariants across several rounds on a fake clock', async () => {
    let t = 0;
    const r = await runSoak({
      now: () => (t += 1000),
      rss: () => 0,
      durationMs: 4000,
      bidders: 4,
      pause: () => Promise.resolve(),
    });
    expect(r.rounds).toBeGreaterThanOrEqual(2);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.ok).toBe(true);
  }, 120_000);
});
