import fc from 'fast-check';
import { SEED as PROPERTY_SEED, runsFor } from '../property-params.js';
import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/commands.js';
import { evolve } from '../../src/evolve.js';
import type { LedgerEntry } from '../../src/events.js';
import * as api from '../../src/index.js';
import { GENESIS_PREV, verifyChain } from '../../src/ledger/chain.js';
import { InMemoryLedgerStore } from '../../src/ledger/memory-store.js';
import { replay, stateDigest } from '../../src/replay.js';
import { AuctionRuntime } from '../../src/runtime.js';
import { initialState } from '../../src/state.js';
import type { AuctionState } from '../../src/state.js';
import type { Mode, Ulid } from '../../src/types.js';
import { A, AU, B, C, L1, L2, id, lotConfig, mk } from '../decide-helpers.js';

// Seeded like the other property files; set GAVEL_PROPERTY_SEED / GAVEL_PROPERTY_RUNS to replay.
const SEED = PROPERTY_SEED;
const NUM_RUNS = runsFor('ledger', 60);
const params = { seed: SEED, numRuns: NUM_RUNS };
const SLOW = 120_000;

const L3 = id('M3');
const LOTS: readonly Ulid[] = [L1, L2, L3];
const BIDDERS: readonly Ulid[] = [A, B, C];

interface Op {
  kind: 'bid' | 'open' | 'hammer' | 'tick' | 'complete' | 'promote' | 'revoke';
  who: number;
  lot: number;
  amount: number;
  dt: number;
}

const op: fc.Arbitrary<Op> = fc.record({
  kind: fc.constantFrom(
    'bid',
    'bid',
    'bid',
    'open',
    'hammer',
    'tick',
    'complete',
    'promote',
    'revoke',
  ) as fc.Arbitrary<Op['kind']>,
  who: fc.integer({ min: 0, max: 2 }),
  lot: fc.integer({ min: 0, max: 2 }),
  amount: fc.integer({ min: 100, max: 40000 }),
  dt: fc.integer({ min: 0, max: 6000 }),
});

const scenario = fc.record({
  modes: fc.array(fc.constantFrom<Mode>('english', 'proxy', 'second_price'), {
    minLength: 3,
    maxLength: 3,
  }),
  ops: fc.array(op, { minLength: 1, maxLength: 40 }),
});

function commandFor(s: AuctionState, o: Op, at: number): Command | null {
  const lotId = LOTS[o.lot] ?? L1;
  const bidderId = BIDDERS[o.who] ?? A;
  const lot = s.lots[lotId];
  switch (o.kind) {
    case 'bid':
      return mk(at, {
        type: 'PlaceBid',
        lotId,
        bidderId,
        amountCents: o.amount,
        source: 'manual',
        audit: {},
      });
    case 'open': {
      const next = s.lotOrder.find((x) => s.lots[x]?.status === 'PENDING');
      return next === undefined ? null : mk(at, { type: 'OpenLot', lotId: next });
    }
    case 'hammer':
      return mk(at, { type: 'Hammer', lotId, early: true, actor: 'prop' });
    case 'tick':
      return mk(at, { type: 'Tick' });
    case 'complete':
      if (lot === undefined || lot.winnerId === null || lot.priceCents === null) return null;
      return mk(at, {
        type: 'CompleteLot',
        lotId,
        bidderId: lot.winnerId,
        capturedCents: lot.priceCents,
        ref: 'prop',
      });
    case 'promote':
      if (lot === undefined || lot.winnerId === null) return null;
      return mk(at, {
        type: 'PromoteRunnerUp',
        lotId,
        disqualifiedBidderId: lot.winnerId,
        reason: 'prop',
      });
    case 'revoke':
      return o.amount % 7 === 0
        ? mk(at, { type: 'RevokeCeiling', bidderId, reason: 'declined' })
        : null;
  }
}

/** Runs a scenario through the runtime and returns the ledger and every live state after a command. */
async function runScenario(
  modes: readonly Mode[],
  ops: readonly Op[],
): Promise<{ store: InMemoryLedgerStore; rt: AuctionRuntime; lives: AuctionState[] }> {
  const store = new InMemoryLedgerStore();
  const rt = new AuctionRuntime({ store });
  const lives: AuctionState[] = [];
  const send = async (cmd: Command): Promise<void> => {
    try {
      await rt.dispatch(cmd);
    } catch {
      // A refused command appends nothing; the next one carries on.
    }
    lives.push(await rt.state(AU));
  };
  await send(mk(0, { type: 'CreateAuction', title: 'Gala', config: {} }));
  for (const [i, lotId] of LOTS.entries()) {
    await send(mk(0, { type: 'AddLot', lot: lotConfig(lotId, { mode: modes[i] ?? 'english' }) }));
  }
  for (const bidderId of BIDDERS) {
    await send(mk(0, { type: 'RegisterBidder', bidderId, ceilingCents: 60000 }));
  }
  let at = 0;
  for (const o of ops) {
    at += o.dt;
    const cmd = commandFor(await rt.state(AU), o, at);
    if (cmd !== null) await send(cmd);
  }
  return { store, rt, lives };
}

const clone = (e: LedgerEntry): LedgerEntry => JSON.parse(JSON.stringify(e)) as LedgerEntry;
const cloneAll = (es: readonly LedgerEntry[]): LedgerEntry[] => es.map(clone);

describe('ledger properties', () => {
  it(
    'T-ENG-072 R-ENG-093 replayed state equals live state at every prefix of any ledger',
    async () => {
      await fc.assert(
        fc.asyncProperty(scenario, async ({ modes, ops }) => {
          const { store, rt } = await runScenario(modes, ops);
          const entries = await store.read(AU, 1);
          let live: AuctionState = initialState;
          for (const [i, e] of entries.entries()) {
            live = evolve(live, e);
            const replayed = replay(entries.slice(0, i + 1));
            expect(stateDigest(replayed)).toBe(stateDigest(live));
          }
          // The runtime's own cache and a cold restart agree with the full replay.
          const fresh = new AuctionRuntime({ store });
          expect(stateDigest(await fresh.state(AU))).toBe(stateDigest(await rt.state(AU)));
          expect(stateDigest(await rt.state(AU))).toBe(stateDigest(live));
        }),
        params,
      );
    },
    SLOW,
  );

  it(
    'T-ENG-065 R-ENG-093 the digest differs as soon as the state differs',
    async () => {
      await fc.assert(
        fc.asyncProperty(scenario, async ({ modes, ops }) => {
          const { lives } = await runScenario(modes, ops);
          for (let i = 1; i < lives.length; i += 1) {
            const prev = lives[i - 1];
            const cur = lives[i];
            if (prev === undefined || cur === undefined) continue;
            if (prev.head.seq !== cur.head.seq) {
              expect(stateDigest(cur)).not.toBe(stateDigest(prev));
            }
          }
        }),
        params,
      );
    },
    SLOW,
  );

  describe('R-ENG-074 verifyChain detects every kind of damage', () => {
    const kinds = [
      'field',
      'payload',
      'reorder',
      'delete',
      'duplicate',
      'prev',
      'hash',
      'seq',
      'truncate',
    ] as const;
    type Kind = (typeof kinds)[number];

    function damage(entries: LedgerEntry[], kind: Kind, pick: number): LedgerEntry[] {
      const out = cloneAll(entries);
      const i = pick % out.length;
      const at = out[i];
      if (at === undefined) throw new Error('empty ledger');
      switch (kind) {
        case 'field':
          out[i] = { ...at, cmd: at.cmd === null ? AU : null } as LedgerEntry;
          return out;
        case 'payload':
          out[i] = { ...at, payload: { ...at.payload, tampered: 1 } } as unknown as LedgerEntry;
          return out;
        case 'reorder': {
          const j = i === out.length - 1 ? i - 1 : i;
          const x = out[j];
          const y = out[j + 1];
          if (x === undefined || y === undefined) throw new Error('need two entries');
          out[j] = y;
          out[j + 1] = x;
          return out;
        }
        case 'delete': {
          // A middle entry: never the first or the last one.
          const k = 1 + (pick % (out.length - 2));
          out.splice(k, 1);
          return out;
        }
        case 'duplicate':
          out.splice(i, 0, clone(at));
          return out;
        case 'prev':
          out[i] = {
            ...at,
            prev: at.prev === 'f'.repeat(64) ? GENESIS_PREV : 'f'.repeat(64),
          } as LedgerEntry;
          return out;
        case 'hash':
          out[i] = {
            ...at,
            hash: at.hash === 'e'.repeat(64) ? 'd'.repeat(64) : 'e'.repeat(64),
          } as LedgerEntry;
          return out;
        case 'seq':
          out[i] = { ...at, seq: at.seq + 1 } as LedgerEntry;
          return out;
        case 'truncate':
          out.pop();
          return out;
      }
    }

    it(
      'T-ENG-073 R-ENG-074 a single mutation of any kind is caught',
      async () => {
        await fc.assert(
          fc.asyncProperty(
            scenario,
            fc.constantFrom(...kinds),
            fc.nat(10_000),
            async ({ modes, ops }, kind, pick) => {
              const { store } = await runScenario(modes, ops);
              const entries = await store.read(AU, 1);
              const head = entries.at(-1);
              if (head === undefined) throw new Error('empty ledger');
              const expectedHead = { seq: head.seq, hash: head.hash };
              const ok = verifyChain(entries, { expectedHead });
              expect(ok).toEqual({ ok: true, count: entries.length, headHash: head.hash });

              const bad = damage(entries, kind, pick);
              const res = verifyChain(bad, { expectedHead });
              expect(res.ok).toBe(false);
              if (res.ok) return;
              expect(res.firstBadIndex).toBeGreaterThanOrEqual(0);
              expect(res.firstBadIndex).toBeLessThanOrEqual(bad.length);
              // Without the expected head a pure tail cut cannot be seen; every other damage can.
              if (kind !== 'truncate') expect(verifyChain(bad).ok).toBe(false);
              // A damaged ledger never replays.
              expect(() => replay(bad, undefined, expectedHead)).toThrow();
            },
          ),
          params,
        );
      },
      SLOW,
    );

    it(
      'T-ENG-056 R-ENG-074 a field change is reported at the entry that holds it',
      async () => {
        await fc.assert(
          fc.asyncProperty(scenario, fc.nat(10_000), async ({ modes, ops }, pick) => {
            const { store } = await runScenario(modes, ops);
            const entries = await store.read(AU, 1);
            const i = pick % entries.length;
            for (const kind of ['field', 'payload', 'prev', 'hash', 'seq'] as const) {
              const res = verifyChain(damage(entries, kind, pick));
              expect(res).toMatchObject({ ok: false, firstBadIndex: i });
            }
          }),
          params,
        );
      },
      SLOW,
    );
  });

  it('T-ENG-074 R-ENG-077 sealed entries are deeply frozen and the public API cannot edit or delete one', async () => {
    const { store } = await runScenario(
      ['english', 'proxy', 'second_price'],
      [
        { kind: 'open', who: 0, lot: 0, amount: 100, dt: 10 },
        { kind: 'bid', who: 0, lot: 0, amount: 2000, dt: 10 },
        { kind: 'bid', who: 1, lot: 0, amount: 3000, dt: 10 },
        { kind: 'hammer', who: 0, lot: 0, amount: 100, dt: 10 },
      ],
    );
    const entries = await store.read(AU, 1);
    expect(entries.length).toBeGreaterThan(8);
    const frozen = (v: unknown): boolean =>
      typeof v !== 'object' || v === null || (Object.isFrozen(v) && Object.values(v).every(frozen));
    for (const e of entries) {
      expect(frozen(e)).toBe(true);
      expect(() => {
        (e as { at: number }).at = 1;
      }).toThrow(TypeError);
      expect(() => {
        (e.payload as unknown as Record<string, unknown>)['extra'] = 1;
      }).toThrow(TypeError);
    }
    const mutator = /^(update|delete|remove|rewrite|edit|patch|truncate|overwrite)/i;
    expect(Object.keys(api).filter((k) => mutator.test(k))).toEqual([]);
    const storeApi = Object.getOwnPropertyNames(InMemoryLedgerStore.prototype).sort();
    expect(storeApi).toEqual(['append', 'constructor', 'head', 'read']);
  });
});
