import { describe, expect, it } from 'vitest';
import { InMemoryLedgerStore } from '../src/ledger/memory-store.js';
import { AuctionRuntime } from '../src/runtime.js';
import type { DecisionMetric } from '../src/runtime-metrics.js';
import { ManualClock } from '../src/clock.js';
import { A, mk } from './decide-helpers.js';

const create = () => mk(0, { type: 'CreateAuction', title: 'Gala', config: {} });

describe('AuctionRuntime onDecision', () => {
  it('T-ENG-076 R-ENG-105 one metric per command with a duration and the entries', async () => {
    const metrics: DecisionMetric[] = [];
    const clock = new ManualClock(100);
    const rt = new AuctionRuntime({
      store: new InMemoryLedgerStore(),
      onDecision: (m) => metrics.push(m),
      clock,
    });
    const c = create();
    await rt.dispatch(c);
    clock.advance(5);
    await rt.dispatch(c);
    await rt.dispatch(mk(1, { type: 'RegisterBidder', bidderId: A, ceilingCents: 5000 }));
    expect(metrics.map((m) => [m.commandType, m.outcome, m.entries.length])).toEqual([
      ['CreateAuction', 'accepted', 1],
      ['CreateAuction', 'duplicate', 1],
      ['RegisterBidder', 'accepted', 1],
    ]);
    for (const m of metrics) {
      expect(Number.isFinite(m.durationMs)).toBe(true);
      expect(m.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('T-ENG-076 R-ENG-105 a throwing or rejecting hook does not change the result', async () => {
    const plain = new AuctionRuntime({ store: new InMemoryLedgerStore() });
    const sync = new AuctionRuntime({
      store: new InMemoryLedgerStore(),
      onDecision: () => {
        throw new Error('boom');
      },
    });
    const asyncHook = new AuctionRuntime({
      store: new InMemoryLedgerStore(),
      onDecision: () => Promise.reject(new Error('boom')),
    });
    const expected = await plain.dispatch(create());
    for (const rt of [sync, asyncHook]) {
      const got = await rt.dispatch(create());
      expect(got.outcome).toEqual(expected.outcome);
      expect(got.entries.map((e) => e.type)).toEqual(expected.entries.map((e) => e.type));
    }
  });

  it('T-ENG-076 R-ENG-105 a failed command is not measured as a decision', async () => {
    const metrics: DecisionMetric[] = [];
    const rt = new AuctionRuntime({
      store: new InMemoryLedgerStore(),
      onDecision: (m) => metrics.push(m),
    });
    await expect(
      rt.dispatch(mk(0, { type: 'RegisterBidder', bidderId: A, ceilingCents: 5000 })),
    ).rejects.toThrow();
    expect(metrics).toEqual([]);
  });
});
