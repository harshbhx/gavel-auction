import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/limits/rate-limiter';
import { setup } from './room-harness';

describe('a bid flood on one socket is answered rate_limited (S10, R-RT-120)', () => {
  it('lets the burst through and refuses the rest with a retry hint', async () => {
    const t = await setup({ limiter: true });
    const c = await t.connect('bidder', t.b1);
    for (let i = 0; i < 200; i += 1) await t.room.submitBid(c.conn, t.bid(10000 + i * 100));
    const limited = c.transport.messages('error').filter((m) => m.code === 'rate_limited');
    expect(limited).toHaveLength(200 - LIMITS.bid.burst);
    for (const m of limited) expect(Number(m.retryAfterMs)).toBeGreaterThan(0);
  });

  it('keeps one bidder flood from limiting another bidder', async () => {
    const t = await setup({ limiter: true });
    const a = await t.connect('bidder', t.b1);
    const b = await t.connect('bidder', t.b2);
    for (let i = 0; i < 50; i += 1) await t.room.submitBid(a.conn, t.bid(10000 + i * 100));
    await t.room.submitBid(b.conn, t.bid(90000));
    expect(b.transport.messages('error').map((m) => m.code)).not.toContain('rate_limited');
  });
});
