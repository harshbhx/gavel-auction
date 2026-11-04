import { describe, expect, it } from 'vitest';
import { LedgerConflict } from '../src/ledger/store.js';
import type { LedgerStore } from '../src/ledger/store.js';
import { InMemoryLedgerStore } from '../src/ledger/memory-store.js';
import { AuctionRuntime } from '../src/runtime.js';
import { AU, A, B, mk } from './decide-helpers.js';

const create = () => mk(0, { type: 'CreateAuction', title: 'Gala', config: {} });
const register = (bidderId: typeof A, at = 1) =>
  mk(at, { type: 'RegisterBidder', bidderId, ceilingCents: 5000 });

describe('AuctionRuntime recovery', () => {
  it('T-ENG-072 R-ENG-101 a concurrent writer is absorbed by rehydrating and retrying', async () => {
    const store = new InMemoryLedgerStore();
    const first = new AuctionRuntime({ store });
    const second = new AuctionRuntime({ store });
    await first.dispatch(create());
    await first.state(AU);
    await second.dispatch(register(A));
    const r = await first.dispatch(register(B, 2));
    expect(r.entries.map((e) => e.seq)).toEqual([3]);
    expect((await store.read(AU, 1)).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect((await first.state(AU)).head.seq).toBe(3);
  });

  it('T-ENG-072 R-ENG-101 four consecutive conflicts surface store_conflict', async () => {
    const inner = new InMemoryLedgerStore();
    let calls = 0;
    const store: LedgerStore = {
      append: (_a, _e, h) => {
        calls += 1;
        return Promise.reject(new LedgerConflict(h, h + 1));
      },
      read: (a, f) => inner.read(a, f),
      head: (a) => inner.head(a),
    };
    const rt = new AuctionRuntime({ store });
    const err = await rt.dispatch(create()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'store_conflict' });
    expect(calls).toBe(4);
  });

  it('T-ENG-072 R-ENG-101 the third retry may still succeed', async () => {
    const inner = new InMemoryLedgerStore();
    let calls = 0;
    const store: LedgerStore = {
      append: (a, e, h) => {
        calls += 1;
        return calls <= 3 ? Promise.reject(new LedgerConflict(h, h)) : inner.append(a, e, h);
      },
      read: (a, f) => inner.read(a, f),
      head: (a) => inner.head(a),
    };
    const rt = new AuctionRuntime({ store });
    const r = await rt.dispatch(create());
    expect(r.entries).toHaveLength(1);
    expect(calls).toBe(4);
  });

  it('T-ENG-073 R-ENG-102 R-ENG-087 a timeout after the write returns the stored entries once', async () => {
    const inner = new InMemoryLedgerStore();
    let timeouts = 0;
    const store: LedgerStore = {
      append: async (a, e, h) => {
        await inner.append(a, e, h);
        timeouts += 1;
        throw new Error('timeout');
      },
      read: (a, f) => inner.read(a, f),
      head: (a) => inner.head(a),
    };
    const notified: number[] = [];
    const rt = new AuctionRuntime({ store, onEntries: (_a, es) => notified.push(es.length) });
    const cmd = create();
    const r = await rt.dispatch(cmd);
    expect(timeouts).toBe(1);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.cmd).toBe(cmd.commandId);
    expect(await inner.read(AU, 1)).toHaveLength(1);
    expect(notified).toEqual([1]);
    expect((await rt.state(AU)).head.seq).toBe(1);
  });

  it('R-ENG-102 a failure that wrote nothing is surfaced, not retried', async () => {
    const inner = new InMemoryLedgerStore();
    let calls = 0;
    const store: LedgerStore = {
      append: () => {
        calls += 1;
        return Promise.reject(new Error('down'));
      },
      read: (a, f) => inner.read(a, f),
      head: (a) => inner.head(a),
    };
    const rt = new AuctionRuntime({ store });
    await expect(rt.dispatch(create())).rejects.toThrow('down');
    expect(calls).toBe(1);
  });
});
