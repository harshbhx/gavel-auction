import { describe, expect, it } from 'vitest';
import { InMemoryLedgerStore } from '../src/ledger/memory-store.js';
import { AuctionRuntime } from '../src/runtime.js';
import { AU, id, mk } from './decide-helpers.js';

const reg = (n: number) =>
  mk(1, {
    type: 'RegisterBidder',
    bidderId: id(`F${n.toString(16).toUpperCase().padStart(3, '0')}`),
    ceilingCents: 5000,
  });

describe('AuctionRuntime subscribe', () => {
  it('T-ENG-074 R-ENG-103 replays from fromSeq then follows live appends once each in order', async () => {
    const rt = new AuctionRuntime({ store: new InMemoryLedgerStore() });
    await rt.dispatch(mk(0, { type: 'CreateAuction', title: 'Gala', config: {} }));
    for (let i = 0; i < 9; i++) await rt.dispatch(reg(i));
    expect((await rt.state(AU)).head.seq).toBe(10);

    const seen: number[] = [];
    const done = (async () => {
      for await (const e of rt.subscribe(AU, 5)) {
        seen.push(e.seq);
        if (e.seq === 13) break;
      }
    })();
    for (let i = 9; i < 12; i++) await rt.dispatch(reg(i));
    await done;
    expect(seen).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('R-ENG-103 a subscriber that attaches late sees no duplicate of an entry it replayed', async () => {
    const rt = new AuctionRuntime({ store: new InMemoryLedgerStore() });
    await rt.dispatch(mk(0, { type: 'CreateAuction', title: 'Gala', config: {} }));
    const seen: number[] = [];
    const it = rt.subscribe(AU, 1)[Symbol.asyncIterator]();
    const first = await it.next();
    if (first.done === true) throw new Error('stream ended');
    seen.push(first.value.seq);
    const pending = it.next();
    await Promise.all([rt.dispatch(reg(1)), rt.dispatch(reg(2))]);
    for (const p of [pending, it.next()]) {
      const r = await p;
      if (r.done === true) throw new Error('stream ended');
      seen.push(r.value.seq);
    }
    await it.return?.();
    expect(seen).toEqual([1, 2, 3]);
  });

  it('R-ENG-103 entries written by another runtime are filled in from the store', async () => {
    const store = new InMemoryLedgerStore();
    const mine = new AuctionRuntime({ store });
    const other = new AuctionRuntime({ store });
    await mine.dispatch(mk(0, { type: 'CreateAuction', title: 'Gala', config: {} }));
    const it = mine.subscribe(AU, 1)[Symbol.asyncIterator]();
    expect((await it.next()).value?.seq).toBe(1);
    const next = it.next();
    await other.dispatch(reg(1));
    await mine.dispatch(reg(2));
    const seqs = [(await next).value?.seq, (await it.next()).value?.seq];
    await it.return?.();
    expect(seqs).toEqual([2, 3]);
  });
});
