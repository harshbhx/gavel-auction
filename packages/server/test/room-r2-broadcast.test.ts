import { describe, expect, it } from 'vitest';
import { setup } from './room-harness';

describe('a throwing transport does not abort the broadcast (#955)', () => {
  it('still reaches later connections and detaches the broken one', async () => {
    const t = await setup();
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('screen');
    const c3 = await t.connect('screen');
    let attempts = 0;
    c2.transport.send = () => {
      attempts += 1;
      throw new Error('socket closed');
    };
    await expect(t.room.submitBid(c1.conn, t.bid(35000))).resolves.toBeUndefined();
    expect(c3.transport.messages('price')).toHaveLength(1);
    expect(c3.transport.messages('audit_event')).toHaveLength(1);
    expect(c1.transport.messages('bid_accepted')).toHaveLength(1);
    const first = attempts;
    expect(first).toBeGreaterThan(0);
    await t.room.submitBid(c1.conn, t.bid(36000));
    expect(attempts).toBe(first);
  });
});
