import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands.js';
import type { LedgerEntry } from '../src/events.js';
import { InMemoryLedgerStore } from '../src/ledger/memory-store.js';
import type { LedgerStore } from '../src/ledger/store.js';
import { stateDigest } from '../src/replay.js';
import { AuctionRuntime } from '../src/runtime.js';
import { AU, id, mk } from './decide-helpers.js';
import type { Ulid } from '../src/types.js';

const bidderIds = (n: number): Ulid[] =>
  Array.from({ length: n }, (_, i) => id(`F${i.toString(16).toUpperCase().padStart(3, '0')}`));

function setupCommands(n: number): Command[] {
  return [
    mk(0, { type: 'CreateAuction', title: 'Gala', config: {} }),
    ...bidderIds(n).map((bidderId) =>
      mk(1, { type: 'RegisterBidder', bidderId, ceilingCents: 5000 }),
    ),
  ];
}

describe('AuctionRuntime', () => {
  it('T-ENG-070 R-ENG-098 R-ENG-099 concurrent dispatch is serial and restart is identical', async () => {
    const store = new InMemoryLedgerStore();
    const rt = new AuctionRuntime({ store });
    const cmds = setupCommands(199);
    const results = await Promise.all(cmds.map((c) => rt.dispatch(c)));
    const seqs = results.flatMap((r) => r.entries.map((e) => e.seq));
    expect(seqs).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
    const ledger = await store.read(AU, 1);
    expect(ledger.map((e) => e.cmd)).toEqual(cmds.map((c) => c.commandId));

    const fresh = new AuctionRuntime({ store });
    const live = await rt.state(AU);
    const restarted = await fresh.state(AU);
    expect(stateDigest(restarted)).toBe(stateDigest(live));
    expect(restarted.head.seq).toBe(200);
  });

  it('T-ENG-071 R-ENG-100 nothing is returned or announced before the store acknowledges', async () => {
    const inner = new InMemoryLedgerStore();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: LedgerStore = {
      append: async (a, e, h) => {
        await gate;
        return inner.append(a, e, h);
      },
      read: (a, f) => inner.read(a, f),
      head: (a) => inner.head(a),
    };
    const log: string[] = [];
    const seen: LedgerEntry[] = [];
    const rt = new AuctionRuntime({
      store: slow,
      onEntries: (_a, entries) => {
        log.push('notify');
        seen.push(...entries);
      },
    });
    const pending = rt
      .dispatch(mk(0, { type: 'CreateAuction', title: 'Gala', config: {} }))
      .then((r) => {
        log.push('result');
        return r;
      });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(log).toEqual([]);
    expect(await inner.head(AU)).toBeNull();
    release();
    const r = await pending;
    expect(log).toEqual(['notify', 'result']);
    expect(r.entries).toEqual(seen);
    expect((await inner.head(AU))?.seq).toBe(1);
  });

  it('T-ENG-070 R-ENG-098 a failing command does not stop the commands queued behind it', async () => {
    const rt = new AuctionRuntime({ store: new InMemoryLedgerStore() });
    const bad = rt.dispatch(mk(0, { type: 'Tick' }));
    const good = rt.dispatch(mk(0, { type: 'CreateAuction', title: 'Gala', config: {} }));
    await expect(bad).rejects.toThrow('bad_command');
    expect((await good).entries).toHaveLength(1);
  });

  it('T-ENG-070 R-ENG-099 a failed append drops the cache and the next command rehydrates', async () => {
    const inner = new InMemoryLedgerStore();
    let fail = false;
    const flaky: LedgerStore = {
      append: (a, e, h) => (fail ? Promise.reject(new Error('down')) : inner.append(a, e, h)),
      read: (a, f) => inner.read(a, f),
      head: (a) => inner.head(a),
    };
    const rt = new AuctionRuntime({ store: flaky });
    const [create, first] = setupCommands(2);
    if (create === undefined || first === undefined) throw new Error('commands missing');
    await rt.dispatch(create);
    fail = true;
    await expect(rt.dispatch(first)).rejects.toThrow('down');
    fail = false;
    expect((await rt.state(AU)).head.seq).toBe(1);
    expect((await rt.dispatch(first)).entries[0]?.seq).toBe(2);
  });

  it('T-ENG-070 R-ENG-087 a retried command appends nothing', async () => {
    const store = new InMemoryLedgerStore();
    const rt = new AuctionRuntime({ store });
    const create = mk(0, { type: 'CreateAuction', title: 'Gala', config: {} });
    const first = await rt.dispatch(create);
    const again = await rt.dispatch(create);
    expect(again.entries).toEqual(first.entries);
    expect(again.outcome.kind).toBe('duplicate');
    expect(await store.read(AU, 1)).toHaveLength(1);
  });
});
