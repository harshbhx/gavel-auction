import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ManualClock } from '../../src/clock.js';
import type { Command } from '../../src/commands.js';
import { EngineError } from '../../src/errors.js';
import type { LedgerEntry } from '../../src/events.js';
import { verifyChain } from '../../src/ledger/chain.js';
import { InMemoryLedgerStore } from '../../src/ledger/memory-store.js';
import { stateDigest } from '../../src/replay.js';
import { AuctionRuntime } from '../../src/runtime.js';
import type { RuntimeResult } from '../../src/runtime.js';
import { runStoreContract } from '../../src/testing/store-contract.js';
import { FaultyStore, InjectedFault } from '../../src/testing/faulty-store.js';
import type { Fault, FaultPlan } from '../../src/testing/faulty-store.js';
import type { AuctionState } from '../../src/state.js';
import type { Ulid } from '../../src/types.js';
import { A, AU, B, L1, id, lotConfig, mk } from '../decide-helpers.js';

// Seeded like the other property files; set GAVEL_PROPERTY_SEED / GAVEL_PROPERTY_RUNS to replay.
const SEED = Number(process.env['GAVEL_PROPERTY_SEED'] ?? 20261104);
const NUM_RUNS = Number(process.env['GAVEL_PROPERTY_RUNS'] ?? 60);
const params = { seed: SEED, numRuns: NUM_RUNS };
const SLOW = 120_000;

const AU2 = id('AAB');
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const create = (at = 0): Command => mk(at, { type: 'CreateAuction', title: 'Gala', config: {} });
const register = (bidderId: Ulid, at = 1): Command =>
  mk(at, { type: 'RegisterBidder', bidderId, ceilingCents: 50000 });
const on = (auctionId: Ulid, cmd: Command): Command => ({ ...cmd, auctionId }) as Command;

function rig(plan: FaultPlan = [], opts: { onEntries?: (e: readonly LedgerEntry[]) => void } = {}) {
  const inner = new InMemoryLedgerStore();
  const store = new FaultyStore(inner, plan);
  const notified: LedgerEntry[][] = [];
  const observerErrors: unknown[] = [];
  const rt = new AuctionRuntime({
    store,
    onEntries: (_a, entries) => {
      notified.push([...entries]);
      opts.onEntries?.(entries);
    },
    onObserverError: (e) => observerErrors.push(e),
  });
  return { inner, store, rt, notified, observerErrors };
}

describe('FaultyStore', () => {
  runStoreContract(() => Promise.resolve(new FaultyStore(new InMemoryLedgerStore())));

  it('records every call with the fault it got', async () => {
    const { store, rt } = rig([null, { kind: 'delay', ms: 1 }]);
    await rt.dispatch(create());
    await rt.dispatch(register(A));
    expect(store.calls.map((c) => c.fault)).toEqual(['none', 'delay']);
    expect(store.persistedSeq(AU)).toBe(2);
  });
});

describe('runtime under store faults', () => {
  it('T-ENG-071 R-ENG-100 a rejected append returns no result, tells no observer and leaves the ledger alone', async () => {
    const { inner, rt, notified } = rig([null, { kind: 'fail_before' }]);
    await rt.dispatch(create());
    await expect(rt.dispatch(register(A))).rejects.toBeInstanceOf(InjectedFault);
    expect(await inner.read(AU, 1)).toHaveLength(1);
    expect(notified.map((n) => n.length)).toEqual([1]);
    const again = await rt.dispatch(register(A, 2));
    expect(again.entries.map((e) => e.seq)).toEqual([2]);
    expect((await rt.state(AU)).head.seq).toBe(2);
  });

  it('T-ENG-073 R-ENG-102 a lost acknowledgement still yields the stored entries, once', async () => {
    const { inner, rt, notified, store } = rig([{ kind: 'fail_after' }]);
    const cmd = create();
    const r = await rt.dispatch(cmd);
    expect(r.entries).toEqual(await inner.read(AU, 1));
    expect(notified).toHaveLength(1);
    expect(store.calls).toHaveLength(1);
    const dup = await rt.dispatch(cmd);
    expect(dup.outcome.kind).toBe('duplicate');
    expect(dup.entries).toEqual(r.entries);
    expect(await inner.read(AU, 1)).toHaveLength(1);
  });

  it('T-ENG-072 R-ENG-076 a torn batch is kept whole or not at all', async () => {
    let torn = false;
    const plan: FaultPlan = (c) => {
      // Tear the first batch that holds more than one entry.
      if (!torn && c.entries.length > 1) {
        torn = true;
        return { kind: 'torn' };
      }
      return null;
    };
    const { inner, rt } = rig(plan);
    await rt.dispatch(create());
    await rt.dispatch(mk(1, { type: 'AddLot', lot: lotConfig(L1) }));
    await rt.dispatch(register(A, 2));
    await rt.dispatch(mk(3, { type: 'OpenLot', lotId: L1 }));
    await rt.dispatch(
      mk(4, {
        type: 'PlaceBid',
        lotId: L1,
        bidderId: A,
        amountCents: 1500,
        source: 'manual',
        audit: {},
      }),
    );
    const before = await inner.read(AU, 1);
    const revoke = mk(5, { type: 'RevokeCeiling', bidderId: A, reason: 'declined' });
    await expect(rt.dispatch(revoke)).rejects.toBeInstanceOf(InjectedFault);
    expect(await inner.read(AU, 1)).toEqual(before);
    // The same command, sent again, lands as one batch of two entries with one time.
    const r = await rt.dispatch(revoke);
    expect(r.entries.map((e) => e.type)).toEqual(['CEILING_REVOKED', 'BID_STRUCK']);
    expect(new Set(r.entries.map((e) => e.at)).size).toBe(1);
    expect((await inner.read(AU, 1)).length).toBe(before.length + 2);
  });

  it('R-ENG-100 an observer that fails after the append does not undo or hide the command', async () => {
    const { inner, rt, observerErrors } = rig([], {
      onEntries: () => {
        throw new Error('observer down');
      },
    });
    const r = await rt.dispatch(create());
    expect(r.entries).toHaveLength(1);
    expect(observerErrors).toHaveLength(1);
    expect(await inner.read(AU, 1)).toEqual(r.entries);
    // A process that restarts after the crash sees the entry and every later reader gets it.
    const fresh = new AuctionRuntime({ store: inner });
    expect((await fresh.state(AU)).head.seq).toBe(1);
    const seen: LedgerEntry[] = [];
    for await (const e of fresh.subscribe(AU, 1)) {
      seen.push(e);
      break;
    }
    expect(seen).toEqual(r.entries);
  });

  it('T-ENG-071 R-ENG-100 nothing is announced or returned while the append is still in flight', async () => {
    for (const fault of [
      { kind: 'delay', ms: 60 },
      { kind: 'reorder_ack', ms: 60 },
    ] as Fault[]) {
      const { rt, notified } = rig([fault]);
      let resolved = false;
      const pending = rt.dispatch(create()).then((r) => {
        resolved = true;
        return r;
      });
      await sleep(25);
      expect(resolved).toBe(false);
      expect(notified).toEqual([]);
      const r = await pending;
      expect(notified).toEqual([r.entries]);
    }
  });

  it('R-ENG-100 acknowledgements may overtake each other across auctions; each ledger stays intact', async () => {
    const plan: FaultPlan = (c) => (c.auctionId === AU ? { kind: 'reorder_ack', ms: 40 } : null);
    const inner = new InMemoryLedgerStore();
    const store = new FaultyStore(inner, plan);
    const order: string[] = [];
    const rt = new AuctionRuntime({ store, onEntries: (a) => order.push(`notify:${a}`) });
    const slow = rt.dispatch(create()).then(() => order.push('result:AU'));
    const fast = rt.dispatch(on(AU2, create())).then(() => order.push('result:AU2'));
    await Promise.all([slow, fast]);
    expect(order.indexOf('result:AU2')).toBeLessThan(order.indexOf('result:AU'));
    expect(order.indexOf(`notify:${AU2}`)).toBeLessThan(order.indexOf(`notify:${AU}`));
    for (const a of [AU, AU2]) {
      const ledger = await inner.read(a, 1);
      expect(ledger).toHaveLength(1);
      expect(verifyChain(ledger).ok).toBe(true);
    }
  });

  it('T-ENG-070 R-ENG-087 the same command delivered twice at once, and again by another process, is applied once', async () => {
    const { inner, rt } = rig([{ kind: 'fail_after' }]);
    const cmd = create();
    const [first, second] = await Promise.all([rt.dispatch(cmd), rt.dispatch(cmd)]);
    expect(first.outcome.kind).toBe('accepted');
    expect(second.outcome.kind).toBe('duplicate');
    expect(second.entries).toEqual(first.entries);
    const other = new AuctionRuntime({ store: inner });
    const third = await other.dispatch(cmd);
    expect(third.outcome.kind).toBe('duplicate');
    expect(await inner.read(AU, 1)).toHaveLength(1);
  });

  it('R-ENG-004 a command older than the head, or ahead of the clock, appends nothing and does not poison the runtime', async () => {
    const clock = new ManualClock(10_000);
    const inner = new InMemoryLedgerStore();
    const rt = new AuctionRuntime({ store: inner, clock, maxClockSkewMs: 500 });
    await rt.dispatch(create(9_000));
    await rt.dispatch(register(A, 9_500));
    const code = async (cmd: Command): Promise<string> =>
      rt.dispatch(cmd).then(
        () => 'ok',
        (e: unknown) => (e instanceof EngineError ? e.code : 'other'),
      );
    expect(await code(register(B, 9_000))).toBe('time_regression');
    expect(await code(register(B, 10_501))).toBe('bad_time');
    expect(await inner.read(AU, 1)).toHaveLength(2);
    // The wall clock moving backwards changes nothing: commands carry their own time.
    clock.set(1_000);
    expect(await code(register(B, 1_400))).toBe('time_regression');
    clock.set(20_000);
    expect(await code(register(B, 10_000))).toBe('ok');
    expect((await rt.state(AU)).head.seq).toBe(3);
  });

  it('T-ENG-072 R-ENG-101 a storm of conflicts is absorbed up to three retries and then surfaced', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 6 }), async (storm) => {
        const plan: FaultPlan = (c) => (c.call < storm ? { kind: 'conflict' } : null);
        const { inner, rt, store } = rig(plan);
        const outcome = await rt.dispatch(create()).then(
          (r) => r,
          (e: unknown) => e,
        );
        if (storm <= 3) {
          expect((outcome as RuntimeResult).entries).toHaveLength(1);
          expect(store.calls).toHaveLength(storm + 1);
          expect(await inner.read(AU, 1)).toHaveLength(1);
        } else {
          expect(outcome).toMatchObject({ code: 'store_conflict' });
          expect(store.calls).toHaveLength(4);
          expect(await inner.read(AU, 1)).toEqual([]);
        }
      }),
      params,
    );
  });

  it('R-ENG-101 two writers on one store never lose or double an acknowledged command', async () => {
    const inner = new InMemoryLedgerStore();
    const a = new AuctionRuntime({ store: inner });
    const b = new AuctionRuntime({ store: inner });
    await a.dispatch(create());
    const bidders = Array.from({ length: 24 }, (_, i) =>
      id(`F${i.toString(16).toUpperCase().padStart(3, '0')}`),
    );
    const cmds = bidders.map((bidderId, i) => register(bidderId, 1 + i));
    const settled = await Promise.allSettled(cmds.map((c, i) => (i % 2 === 0 ? a : b).dispatch(c)));
    const ledger = await inner.read(AU, 1);
    expect(verifyChain(ledger).ok).toBe(true);
    settled.forEach((s, i) => {
      const stored = ledger.filter((e) => e.cmd === cmds[i]?.commandId);
      if (s.status === 'fulfilled') {
        // A command that lost a race may be refused as out of order in time, never half applied.
        expect(stored).toEqual(s.value.entries.length === 0 ? [] : s.value.entries);
      } else {
        expect(stored).toEqual([]);
      }
    });
  });

  const lotOps = fc.array(
    fc.record({
      kind: fc.constantFrom('bid', 'bid', 'bid', 'open', 'hammer', 'tick', 'revoke'),
      amount: fc.integer({ min: 1000, max: 20000 }),
      dt: fc.integer({ min: 0, max: 4000 }),
    }),
    { minLength: 1, maxLength: 25 },
  );

  const faultArb: fc.Arbitrary<Fault | null> = fc.constantFrom<Fault | null>(
    null,
    null,
    null,
    null,
    { kind: 'fail_before' },
    { kind: 'fail_after' },
    { kind: 'torn' },
    { kind: 'conflict' },
    { kind: 'delay', ms: 1 },
    { kind: 'reorder_ack', ms: 1 },
  );

  it(
    'T-ENG-072 T-ENG-073 R-ENG-076 R-ENG-100 any plan of faults leaves a verified ledger that matches every acknowledged result',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(faultArb, { minLength: 70, maxLength: 70 }),
          lotOps,
          async (faults, ops) => {
            const inner = new InMemoryLedgerStore();
            const store = new FaultyStore(inner, faults);
            const early: string[] = [];
            const notified: LedgerEntry[] = [];
            const rt = new AuctionRuntime({
              store,
              onEntries: (a, entries) => {
                const last = entries.at(-1);
                if (last !== undefined && last.seq > store.persistedSeq(a)) early.push(last.hash);
                notified.push(...entries);
              },
            });
            const resolved = new Map<string, RuntimeResult>();
            const failed = new Set<string>();
            const send = async (cmd: Command): Promise<void> => {
              try {
                resolved.set(cmd.commandId, await rt.dispatch(cmd));
              } catch {
                failed.add(cmd.commandId);
              }
            };
            await send(create());
            await send(mk(0, { type: 'AddLot', lot: lotConfig(L1) }));
            await send(register(A, 0));
            let at = 0;
            for (const o of ops) {
              at += o.dt;
              const s: AuctionState = await rt.state(AU);
              if (o.kind === 'bid') {
                await send(
                  mk(at, {
                    type: 'PlaceBid',
                    lotId: L1,
                    bidderId: A,
                    amountCents: o.amount,
                    source: 'manual',
                    audit: {},
                  }),
                );
              } else if (o.kind === 'open') {
                await send(mk(at, { type: 'OpenLot', lotId: L1 }));
              } else if (o.kind === 'hammer') {
                await send(mk(at, { type: 'Hammer', lotId: L1, early: true, actor: 'prop' }));
              } else if (o.kind === 'tick') {
                await send(mk(at, { type: 'Tick' }));
              } else if (s.bidders[A] !== undefined) {
                await send(mk(at, { type: 'RevokeCeiling', bidderId: A, reason: 'declined' }));
              }
            }

            const ledger = await inner.read(AU, 1);
            expect(verifyChain(ledger).ok).toBe(true);
            // Every acknowledged command is in the ledger exactly as it was returned.
            for (const [cmdId, r] of resolved) {
              expect(ledger.filter((e) => e.cmd === cmdId)).toEqual(r.entries);
            }
            // A failed command left nothing behind (all or none).
            for (const cmdId of failed) expect(ledger.some((e) => e.cmd === cmdId)).toBe(false);
            // One command, one batch: one time, consecutive seqs.
            const byCmd = new Map<string, LedgerEntry[]>();
            for (const e of ledger) byCmd.set(e.cmd ?? '', [...(byCmd.get(e.cmd ?? '') ?? []), e]);
            for (const batch of byCmd.values()) {
              expect(new Set(batch.map((e) => e.at)).size).toBe(1);
              batch.forEach((e, i) => expect(e.seq).toBe((batch[0]?.seq ?? 0) + i));
            }
            // Observers heard exactly the acknowledged entries, in order, never before they were stored.
            expect(notified).toEqual(ledger);
            expect(early).toEqual([]);
            const fresh = new AuctionRuntime({ store: inner });
            expect(stateDigest(await fresh.state(AU))).toBe(stateDigest(await rt.state(AU)));
          },
        ),
        params,
      );
    },
    SLOW,
  );
});
