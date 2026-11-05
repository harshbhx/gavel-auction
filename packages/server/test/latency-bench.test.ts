import { describe, expect, it } from 'vitest';
import { TARGET_P95_MS, TARGET_SNAPSHOT_MS, runLatencyBench } from '../bench/latency';

describe('latency harness (R-RT-150, T-RT-100)', () => {
  it('meets the MemoryStore targets over 5000 bids and a 500-bid snapshot', async () => {
    const r = await runLatencyBench();
    expect(r.bids).toBe(5000);
    expect(r.p95Ms).toBeLessThan(TARGET_P95_MS);
    expect(r.snapshotMs).toBeLessThan(TARGET_SNAPSHOT_MS);
  }, 120_000);
});
