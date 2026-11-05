import { describe, expect, it } from 'vitest';
import { runRecover } from '../bench/recover';

describe('recovery (R-RT-153)', () => {
  it('T-RT-102 a 5000-event log recovers in under 2 s and under 20 MB of heap', async () => {
    const r = await runRecover(5000);
    expect(r.events).toBe(5000);
    expect(r.lastSeq).toBe(5000);
    expect(r.price).toBe(10_000 + 500 * 4997);
    expect(r.elapsedMs).toBeLessThan(2000);
    expect(r.heapDeltaBytes).toBeLessThan(20 * 1024 * 1024);
  }, 120_000);
});
