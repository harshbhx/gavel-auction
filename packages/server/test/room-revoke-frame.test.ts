import type { AuctionConfig, BidderId, EpochMs } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { TestEngine, setup } from './room-harness';

/** A test engine that can strike a bidder, the way the real one does on a revoke. */
class RevokingEngine extends TestEngine {
  revoke(bidder: BidderId, _reason: string, _ts: EpochMs): void {
    this.ceilings.delete(bidder);
    if (this.leader === bidder) {
      this.leader = null;
      this.price = null;
    }
  }
}

describe('revoking the only leader (R6-D01, R-RT-036)', () => {
  it('sends every viewer a frame for the revoke seq and shows no leader', async () => {
    const t = await setup({ engine: (cfg: AuctionConfig) => new RevokingEngine(cfg) });
    const c1 = await t.connect('bidder', t.b1);
    const screen = await t.connect('screen');
    await t.room.submitBid(c1.conn, t.bid(10000));
    const before = t.room.lastSeq;
    const outcome = await t.room.revokeBidder(t.b1, 'declined');
    expect(outcome).not.toBe('noop');
    expect(t.room.lastSeq).toBe(before + 1);
    for (const c of [c1, screen]) {
      const frames = c.transport.messages();
      const last = frames.at(-1);
      expect(last?.seq).toBe(t.room.lastSeq);
      expect(last?.t).toBe('state');
    }
  });
});
