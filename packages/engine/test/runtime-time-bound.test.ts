import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import { InMemoryLedgerStore } from '../src/ledger/memory-store.js';
import { AuctionRuntime } from '../src/runtime.js';
import { A, L1, lotConfig, mk } from './decide-helpers.js';

describe('runtime command time bound (ENG-R2-10)', () => {
  it('T-ENG-070 R-ENG-004 a command far ahead of the clock is refused and does not freeze the auction', async () => {
    const clock = new ManualClock(1000);
    const rt = new AuctionRuntime({ store: new InMemoryLedgerStore(), clock });
    await rt.dispatch(mk(1000, { type: 'CreateAuction', title: 'Gala', config: {} }));
    await rt.dispatch(mk(1000, { type: 'AddLot', lot: lotConfig(L1) }));
    await rt.dispatch(mk(1000, { type: 'RegisterBidder', bidderId: A, ceilingCents: 5000 }));
    await rt.dispatch(mk(1000, { type: 'OpenLot', lotId: L1 }));

    const far = mk(Number.MAX_SAFE_INTEGER, { type: 'Tick' });
    await expect(rt.dispatch(far)).rejects.toMatchObject({ code: 'bad_time' });

    const ok = await rt.dispatch(mk(1100, { type: 'Tick' }));
    expect(ok.outcome.kind).toBe('noop');
    const state = await rt.state(far.auctionId);
    expect(state.head.at).toBeLessThan(2000);
  });

  it('T-ENG-070 R-ENG-004 the allowance is the skew option, one minute by default', async () => {
    const clock = new ManualClock(0);
    const rt = new AuctionRuntime({ store: new InMemoryLedgerStore(), clock });
    const edge = mk(60_000, { type: 'CreateAuction', title: 'Gala', config: {} });
    expect((await rt.dispatch(edge)).outcome.kind).toBe('accepted');
    const tight = new AuctionRuntime({
      store: new InMemoryLedgerStore(),
      clock,
      maxClockSkewMs: 10,
    });
    await expect(
      tight.dispatch(mk(11, { type: 'CreateAuction', title: 'Gala', config: {} })),
    ).rejects.toMatchObject({ code: 'bad_time' });
  });
});
