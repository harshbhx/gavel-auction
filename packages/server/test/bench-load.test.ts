import { describe, expect, it } from 'vitest';
import { runLoad } from '../bench/load';

describe('load (R-RT-152)', () => {
  it('T-RT-101 100 bidders at 10 bids/s for 60 s keep order and a shallow mailbox', async () => {
    const r = await runLoad({ bidders: 100, bidsPerSecond: 10, seconds: 60, seed: 7 });
    expect(r.bids).toBe(600);
    expect(r.seqInversions).toBe(0);
    expect(r.maxMailboxDepth).toBeLessThanOrEqual(50);
    expect(r.maxConcurrent).toBe(1);
    expect(r.frames).toBeGreaterThan(r.bids);
  }, 120_000);
});
