import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/commands.js';
import { EngineError } from '../../src/errors.js';
import { InMemoryLedgerStore } from '../../src/ledger/memory-store.js';
import { rank } from '../../src/rules/ranking.js';
import { AuctionRuntime } from '../../src/runtime.js';
import type { RuntimeResult } from '../../src/runtime.js';
import { initialState } from '../../src/state.js';
import type { AuctionState } from '../../src/state.js';
import { loadFixtures } from '../../src/testing/fixtures.js';
import type { Fixture, Step } from '../../src/testing/fixtures.js';
import type { IncrementRule, Mode, Ulid } from '../../src/types.js';
import { A, AU, B, C, L1, L2, id, lotConfig, mk, open, run, scene } from '../decide-helpers.js';

// Seeded like the other property files; set GAVEL_PROPERTY_SEED / GAVEL_PROPERTY_RUNS to replay.
const SEED = Number(process.env['GAVEL_PROPERTY_SEED'] ?? 20261104);
const NUM_RUNS = Number(process.env['GAVEL_PROPERTY_RUNS'] ?? 100);
const params = { seed: SEED, numRuns: NUM_RUNS };
const SLOW = 120_000;

/** One day: far from any engine constant, small enough to stay inside the runtime clock skew. */
const SHIFT = 86_400_000;

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
  windowMs: fc.integer({ min: 0, max: 5000 }),
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
      return mk(at, { type: 'Hammer', lotId, early: o.amount % 2 === 0, actor: 'prop' });
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

function setupCommands(modes: readonly Mode[], windowMs: number, base: number): Command[] {
  return [
    mk(base, { type: 'CreateAuction', title: 'Gala', config: {} }),
    ...LOTS.map((lotId, i) =>
      mk(base, {
        type: 'AddLot',
        lot: lotConfig(lotId, {
          mode: modes[i] ?? 'english',
          softClose:
            modes[i] === 'second_price'
              ? { windowMs: 0, extensionMs: 0, maxExtensions: 3 }
              : { windowMs, extensionMs: windowMs, maxExtensions: 3 },
        }),
      }),
    ),
    ...BIDDERS.map((bidderId) =>
      mk(base, { type: 'RegisterBidder', bidderId, ceilingCents: 60000 }),
    ),
  ];
}

interface Sent {
  cmd: Command;
  result: RuntimeResult | null;
  code: string;
}

async function send(rt: AuctionRuntime, cmd: Command): Promise<Sent> {
  try {
    return { cmd, result: await rt.dispatch(cmd), code: 'ok' };
  } catch (e) {
    if (!(e instanceof EngineError)) throw e;
    return { cmd, result: null, code: e.code };
  }
}

/** Builds the command stream against a live runtime, so every command reflects the state it saw. */
async function play(
  modes: readonly Mode[],
  windowMs: number,
  ops: readonly Op[],
): Promise<{ rt: AuctionRuntime; store: InMemoryLedgerStore; sent: Sent[] }> {
  const store = new InMemoryLedgerStore();
  const rt = new AuctionRuntime({ store });
  const sent: Sent[] = [];
  for (const cmd of setupCommands(modes, windowMs, 0)) sent.push(await send(rt, cmd));
  let at = 0;
  for (const o of ops) {
    at += o.dt;
    const cmd = commandFor(await rt.state(AU), o, at);
    if (cmd !== null) sent.push(await send(rt, cmd));
  }
  return { rt, store, sent };
}

const describeSent = (s: Sent): string =>
  s.result === null
    ? `error:${s.code}`
    : `${s.result.outcome.kind}:${
        s.result.outcome.kind === 'rejected' ? s.result.outcome.reason : ''
      }:${s.result.entries.map((e) => e.type).join(',')}`;

/** Everything about a state that is not a point in time, with deadlines made relative. */
function project(s: AuctionState, shift: number): unknown {
  return s.lotOrder.map((lotId) => {
    const lot = s.lots[lotId];
    return {
      lotId,
      status: lot?.status,
      leaderId: lot?.leaderId,
      winnerId: lot?.winnerId,
      priceCents: lot?.priceCents,
      extensions: lot?.extensions,
      settlement: lot?.settlement,
      capturedCents: lot?.capturedCents,
      endsAt: lot?.endsAt === undefined || lot.endsAt === null ? null : lot.endsAt - shift,
      ranking: rank(lot?.bids ?? []).map((r) => [r.bidderId, r.amountCents]),
      struck: (lot?.bids ?? []).filter((b) => b.status !== 'active').map((b) => b.bidId),
    };
  });
}

describe('invariance properties', () => {
  it(
    'T-ENG-068 R-ENG-096 shifting every command time by a constant changes no outcome, ranking or price',
    async () => {
      await fc.assert(
        fc.asyncProperty(scenario, async ({ modes, windowMs, ops }) => {
          const base = await play(modes, windowMs, ops);
          const store = new InMemoryLedgerStore();
          const shifted = new AuctionRuntime({ store });
          const again: Sent[] = [];
          for (const { cmd } of base.sent) {
            again.push(await send(shifted, { ...cmd, at: cmd.at + SHIFT } as Command));
          }
          expect(again.map(describeSent)).toEqual(base.sent.map(describeSent));
          expect(project(await shifted.state(AU), SHIFT)).toEqual(
            project(await base.rt.state(AU), 0),
          );
        }),
        params,
      );
    },
    SLOW,
  );

  describe('T-ENG-068 R-ENG-096 golden fixtures keep their outcome when every at moves by one day', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'golden');
    const fixtures = loadFixtures(dir);

    const incrementOf = (fx: Fixture): IncrementRule => {
      const ladder = (
        fx.config as { ladder?: Array<{ fromCents: number; incrementCents: number }> }
      ).ladder;
      return ladder === undefined ? { flatCents: fx.config.minIncrement ?? 1 } : { ladder };
    };

    function playFixture(fx: Fixture, shift: number): unknown {
      const ids = new Map<string, Ulid>();
      const idOf = (name: string): Ulid => {
        let u = ids.get(name);
        if (u === undefined) {
          u = id(`B${(ids.size + 1).toString(16).toUpperCase()}`);
          ids.set(name, u);
        }
        return u;
      };
      const cfg = fx.config;
      const sealed = cfg.mode === 'second_price';
      let s: AuctionState = initialState;
      const log: string[] = [];
      let winner: string | null = null;
      let price = 0;
      const step = (at: number, body: Parameters<typeof mk>[1]): void => {
        const r = run(s, mk(Math.max(at + shift, s.head.at), body));
        s = r.state;
        for (const e of r.entries) {
          if (e.type === 'LOT_HAMMERED') {
            winner = e.payload.winnerId;
            price = e.payload.priceCents;
          }
        }
        if (r.result.outcome.kind === 'rejected') log.push(r.result.outcome.reason);
      };
      const attempt = (at: number, body: Parameters<typeof mk>[1]): void => {
        try {
          step(at, body);
        } catch (e) {
          if (!(e instanceof EngineError)) throw e;
          log.push(e.code);
        }
      };
      step(0, { type: 'CreateAuction', title: 'golden', config: { maxCeilingCents: 100_000_000 } });
      step(0, {
        type: 'AddLot',
        lot: {
          lotId: L1,
          title: 'lot',
          mode: cfg.mode,
          reserveCents: cfg.reserve ?? 1,
          increment: incrementOf(fx),
          durationMs: Math.max(1000, cfg.endTs ?? 100000),
          softClose: {
            windowMs: sealed ? 0 : (cfg.softCloseWindow ?? 0),
            extensionMs: sealed ? 0 : (cfg.softCloseExtension ?? 0),
            maxExtensions: Math.min(50, cfg.maxExtensions ?? 10),
          },
          hammer: 'auto',
        },
      });
      step(0, { type: 'OpenLot', lotId: L1 });
      const tick = (at: number): void => {
        const lot = s.lots[L1];
        if (lot?.status === 'OPEN' && lot.endsAt !== null && at + shift >= lot.endsAt) {
          step(at, { type: 'Tick' });
        }
      };
      for (const st of fx.steps as Step[]) {
        const who = idOf(st.bidder ?? '');
        switch (st.op) {
          case 'register':
            attempt(st.at, {
              type: 'RegisterBidder',
              bidderId: who,
              ceilingCents: st.ceiling ?? 0,
            });
            break;
          case 'bid':
            tick(st.at);
            if (s.lots[L1]?.status !== 'OPEN') log.push('closed');
            else {
              attempt(st.at, {
                type: 'PlaceBid',
                lotId: L1,
                bidderId: who,
                amountCents: st.amount ?? 0,
                source: 'manual',
                audit: {},
              });
            }
            break;
          case 'tick':
            tick(st.at);
            break;
          case 'hammer':
            tick(st.at);
            attempt(st.at, { type: 'Hammer', lotId: L1, actor: 'golden' });
            break;
          case 'promote':
            attempt(st.at, {
              type: 'PromoteRunnerUp',
              lotId: L1,
              disqualifiedBidderId: who,
              reason: 'golden',
            });
            break;
          case 'revoke':
            attempt(st.at, { type: 'RevokeCeiling', bidderId: who, reason: 'other' });
            break;
          case 'complete': {
            const lot = s.lots[L1];
            if (lot === undefined || lot.winnerId === null || lot.priceCents === null) {
              log.push('cannot_complete');
            } else {
              attempt(st.at, {
                type: 'CompleteLot',
                lotId: L1,
                bidderId: lot.winnerId,
                capturedCents: lot.priceCents,
                ref: 'golden',
              });
            }
            break;
          }
        }
      }
      const lot = s.lots[L1];
      return {
        winner,
        price,
        log,
        ranking: rank(lot?.bids ?? []).map((r) => [r.bidderId, r.amountCents]),
        endsAt: (lot?.endsAt ?? 0) - shift,
      };
    }

    it.each(fixtures.map((f) => [f.name, f] as const))('fixture %s', (_name, fx) => {
      expect(playFixture(fx, SHIFT)).toEqual(playFixture(fx, 0));
    });

    it('english-01 still has its winner and price after the shift', () => {
      const fx = fixtures.find((f) => f.name === 'english: bid equal to reserve is accepted');
      if (fx === undefined) throw new Error('english-01 fixture missing');
      expect(playFixture(fx, SHIFT)).toMatchObject({ price: 1000, log: [] });
    });
  });

  it(
    'R-ENG-087 re-dispatching a command with an identical body returns the original and appends nothing',
    async () => {
      await fc.assert(
        fc.asyncProperty(scenario, async ({ modes, windowMs, ops }) => {
          const { rt, store, sent } = await play(modes, windowMs, ops);
          const before = await store.read(AU, 1);
          const digestBefore = JSON.stringify(project(await rt.state(AU), 0));
          for (const s of sent) {
            if (s.result === null || s.result.entries.length === 0) continue;
            const again = await rt.dispatch(s.cmd);
            expect(again.outcome.kind).toBe('duplicate');
            expect(again.entries).toEqual(s.result.entries);
          }
          expect(await store.read(AU, 1)).toEqual(before);
          expect(JSON.stringify(project(await rt.state(AU), 0))).toBe(digestBefore);
        }),
        params,
      );
    },
    SLOW,
  );

  it('R-ENG-087 a duplicate delivered at the same moment is applied once', async () => {
    const store = new InMemoryLedgerStore();
    const rt = new AuctionRuntime({ store });
    for (const cmd of setupCommands(['english', 'english', 'english'], 0, 0))
      await rt.dispatch(cmd);
    await rt.dispatch(mk(1, { type: 'OpenLot', lotId: L1 }));
    const bid = mk(2, {
      type: 'PlaceBid',
      lotId: L1,
      bidderId: A,
      amountCents: 1500,
      source: 'manual',
      audit: {},
    });
    const [first, second, third] = await Promise.all([
      rt.dispatch(bid),
      rt.dispatch(bid),
      rt.dispatch(bid),
    ]);
    expect(first.outcome.kind).toBe('accepted');
    expect(second.outcome.kind).toBe('duplicate');
    expect(third.outcome.kind).toBe('duplicate');
    expect(second.entries).toEqual(first.entries);
    const bids = (await store.read(AU, 1)).filter((e) => e.type === 'BID_RECORDED');
    expect(bids).toHaveLength(1);
    // The same id with another body is a conflict, never a second bid.
    await expect(rt.dispatch({ ...bid, amountCents: 1600 } as Command)).rejects.toMatchObject({
      code: 'command_conflict',
    });
  });

  it('T-ENG-069 R-ENG-097 second price: the outcome does not depend on the order bids arrive in', () => {
    const outcome = (
      reserve: number,
      amounts: readonly number[],
      order: readonly number[],
    ): unknown => {
      let s = open(
        scene({
          lots: [
            lotConfig(L1, {
              mode: 'second_price',
              reserveCents: reserve,
              increment: { flatCents: 1 },
            }),
          ],
        }),
        L1,
        100,
      );
      order.forEach((who, k) => {
        s = run(
          s,
          mk(200 + 10 * k, {
            type: 'PlaceBid',
            lotId: L1,
            bidderId: BIDDERS[who] ?? A,
            amountCents: amounts[who] ?? 0,
            source: 'manual',
            audit: {},
          }),
        ).state;
      });
      s = run(s, mk(1000, { type: 'Hammer', lotId: L1, early: true, actor: 'prop' })).state;
      const lot = s.lots[L1];
      return {
        status: lot?.status,
        winner: lot?.winnerId,
        price: lot?.priceCents,
        ranking: rank(lot?.bids ?? []).map((r) => [r.bidderId, r.amountCents]),
      };
    };
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 100, max: 80000 }), { minLength: 3, maxLength: 3 }),
        fc.integer({ min: 100, max: 3000 }),
        fc.shuffledSubarray([0, 1, 2], { minLength: 3, maxLength: 3 }),
        (amounts, reserve, order) => {
          expect(outcome(reserve, amounts, order)).toEqual(outcome(reserve, amounts, [0, 1, 2]));
        },
      ),
      params,
    );
  });
});
