import { describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/canonical.js';
import type { JsonValue } from '../../src/canonical.js';
import { parseCommand } from '../../src/commands.js';
import type { Command } from '../../src/commands.js';
import { decide } from '../../src/decide/index.js';
import { EngineError } from '../../src/errors.js';
import { SETTLEMENT_STATES } from '../../src/events.js';
import type { AuctionState, LotState } from '../../src/state.js';
import { initialState } from '../../src/state.js';
import { LIMITS } from '../../src/types.js';
import {
  A,
  AU,
  B,
  L1,
  L2,
  errCode,
  id,
  lotConfig,
  mk,
  nextId,
  open,
  run,
  scene,
} from '../decide-helpers.js';

// Deterministic fuzzing: the seed is printed and can be replayed with GAVEL_FUZZ_SEED.
const SEED = Number(process.env['GAVEL_FUZZ_SEED'] ?? 20261104);
const RUNS = 10000;
console.log(`engine fuzz tests: seed=${SEED} runs=${RUNS}`);

type Rng = () => number;

/** mulberry32: a small seeded generator, so a failing input can be reproduced. */
function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const FORBIDDEN = ['__proto__', 'constructor', 'prototype'] as const;
const KEYS = [
  'type',
  'commandId',
  'at',
  'auctionId',
  'lotId',
  'lot',
  'bidderId',
  'amountCents',
  'source',
  'audit',
  'config',
  'title',
  'reason',
  'actor',
  'ref',
  'from',
  'to',
  'holdRef',
  'ceilingCents',
  'increment',
  'softClose',
  'transcript',
  'confidence',
  'confirmed',
  'foo',
  ...FORBIDDEN,
] as const;
const TYPES = [
  'CreateAuction',
  'AddLot',
  'RegisterBidder',
  'OpenLot',
  'PlaceBid',
  'Tick',
  'Hammer',
  'RevokeCeiling',
  'PromoteRunnerUp',
  'AbortLot',
  'CompleteLot',
  'RecordSettlement',
  'CloseAuction',
  'Withdraw',
] as const;
const ODD_STRINGS = [
  '',
  ' ',
  'x'.repeat(129),
  'x'.repeat(2001),
  '\u0000',
  '\ud800',
  '\u{1F600}',
  '0'.repeat(26),
  'Z'.repeat(26),
  'a'.repeat(26),
  ...FORBIDDEN,
] as const;
const ODD_NUMBERS = [
  0,
  -0,
  -1,
  1,
  1.5,
  NaN,
  Infinity,
  -Infinity,
  2 ** 31,
  2 ** 53,
  Number.MAX_SAFE_INTEGER,
  100_000_000,
  100_000_001,
] as const;

function randomLeaf(r: Rng): unknown {
  switch (Math.floor(r() * 7)) {
    case 0:
      return null;
    case 1:
      return r() < 0.5;
    case 2:
      return pick(r, ODD_NUMBERS);
    case 3:
      return Math.floor(r() * 100000);
    case 4:
      return pick(r, ODD_STRINGS);
    case 5:
      return pick(r, TYPES);
    default:
      return undefined;
  }
}

function randomValue(r: Rng, depth: number): unknown {
  const roll = r();
  if (depth <= 0 || roll < 0.4) return randomLeaf(r);
  if (roll < 0.55)
    return Array.from({ length: Math.floor(r() * 4) }, () => randomValue(r, depth - 1));
  const o: Record<string, unknown> = {};
  const n = Math.floor(r() * 8);
  for (let i = 0; i < n; i += 1) {
    const k = pick(r, KEYS);
    // Object.defineProperty keeps `__proto__` an own key, as JSON.parse would produce it.
    Object.defineProperty(o, k, {
      value: randomValue(r, depth - 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return o;
}

/** Runs f; returns the EngineError it threw, null if it returned. Any other throw is a failure. */
function engineErrorOf(f: () => unknown, input: unknown): EngineError | null {
  try {
    f();
    return null;
  } catch (e) {
    if (e instanceof EngineError) return e;
    throw new Error(`non-engine failure for ${safeShow(input)}: ${String(e)}`);
  }
}

function safeShow(x: unknown): string {
  try {
    return (
      JSON.stringify(x, (_k, v: unknown) =>
        typeof v === 'number' && !Number.isFinite(v) ? String(v) : v,
      )?.slice(0, 400) ?? 'undefined'
    );
  } catch {
    return '[unprintable]';
  }
}

const protoKeysBefore = Object.getOwnPropertyNames(Object.prototype).sort();
function assertPrototypeIntact(): void {
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(protoKeysBefore);
  expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
}

/** One valid command of every type against `base`; the seeds for structure-aware mutation. */
function validCommands(): Command[] {
  const text = { actor: 'host', reason: 'fuzz', ref: 'r1' };
  return [
    mk(0, { type: 'CreateAuction', title: 'Gala', config: {} }),
    mk(150, { type: 'AddLot', lot: lotConfig(L2) }),
    mk(150, { type: 'RegisterBidder', bidderId: id('BD'), ceilingCents: 5000, holdRef: 'hold' }),
    mk(150, { type: 'OpenLot', lotId: L2 }),
    mk(200, {
      type: 'PlaceBid',
      lotId: L1,
      bidderId: A,
      amountCents: 1500,
      source: 'voice',
      audit: { transcript: 'fifteen hundred', confidenceBps: 9000, utteranceId: 'u1' },
    }),
    mk(300, { type: 'Tick' }),
    mk(300, { type: 'Hammer', lotId: L1, early: true, actor: text.actor }),
    mk(300, { type: 'RevokeCeiling', bidderId: B, reason: 'declined', holdRef: 'hold' }),
    mk(300, { type: 'PromoteRunnerUp', lotId: L1, disqualifiedBidderId: A, reason: text.reason }),
    mk(300, { type: 'AbortLot', lotId: L1, reason: text.reason, actor: text.actor }),
    mk(300, { type: 'CompleteLot', lotId: L1, bidderId: A, capturedCents: 1500, ref: text.ref }),
    mk(300, {
      type: 'RecordSettlement',
      lotId: L1,
      from: SETTLEMENT_STATES[0],
      to: SETTLEMENT_STATES[1],
      ref: text.ref,
    }),
    mk(300, { type: 'CloseAuction' }),
  ];
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Changes one random thing in a JSON copy of a valid command. */
function mutate(r: Rng, cmd: Command): unknown {
  const root = clone(cmd) as unknown as Record<string, unknown>;
  const holders: Array<Record<string, unknown> | unknown[]> = [root];
  const walk = (v: unknown): void => {
    if (typeof v !== 'object' || v === null) return;
    holders.push(v as Record<string, unknown>);
    for (const c of Object.values(v)) walk(c);
  };
  for (const c of Object.values(root)) walk(c);
  const target = pick(r, holders);
  const how = r();
  if (Array.isArray(target)) {
    target.push(randomValue(r, 2));
    return root;
  }
  const keys = Object.keys(target);
  if (how < 0.45 && keys.length > 0) {
    target[pick(r, keys)] = randomValue(r, 2);
  } else if (how < 0.65 && keys.length > 0) {
    delete target[pick(r, keys)];
  } else if (how < 0.85) {
    Object.defineProperty(target, pick(r, KEYS), {
      value: randomValue(r, 2),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    root['type'] = pick(r, TYPES);
  }
  return root;
}

function fuzzBase(): AuctionState {
  return open(scene({ lots: [lotConfig(L1), lotConfig(L2)] }), L1);
}

function checkDecision(state: AuctionState, cmd: Command, input: unknown): void {
  let events: ReturnType<typeof decide>['events'] = [];
  const err = engineErrorOf(() => {
    events = decide(state, cmd).events;
  }, input);
  if (err !== null) return;
  for (const e of events) {
    // A payload is either canonical or refused as non_canonical at seal time, never anything else.
    const failure = engineErrorOf(() => canonicalize(e.payload as unknown as JsonValue), e);
    if (failure !== null) expect(failure.code).toBe('non_canonical');
  }
}

describe('command parsing fuzz (R-ENG-006, R-ENG-007, R-ENG-089)', () => {
  it('T-ENG-063 R-ENG-089: 10000 random values never crash parseCommand or decide', () => {
    const r = rng(SEED);
    const state = fuzzBase();
    for (let i = 0; i < RUNS; i += 1) {
      const input = randomValue(r, 4);
      let parsed: Command | null = null;
      const err = engineErrorOf(() => {
        parsed = parseCommand(input);
      }, input);
      if (err !== null) expect(['bad_command', 'limit_exceeded']).toContain(err.code);
      if (parsed !== null) checkDecision(state, parsed, input);
    }
    assertPrototypeIntact();
  });

  it('T-ENG-063 R-ENG-089: 10000 mutated valid commands only ever fail with an EngineError', () => {
    const r = rng(SEED + 1);
    const state = fuzzBase();
    const seeds = validCommands();
    let accepted = 0;
    for (let i = 0; i < RUNS; i += 1) {
      const input = mutate(r, pick(r, seeds));
      let parsed: Command | null = null;
      const err = engineErrorOf(() => {
        parsed = parseCommand(input);
      }, input);
      if (err !== null) expect(['bad_command', 'limit_exceeded']).toContain(err.code);
      if (parsed !== null) {
        accepted += 1;
        checkDecision(state, parsed, input);
      }
    }
    // Some mutations are harmless (for example an unchanged field), so parsing must succeed often.
    expect(accepted).toBeGreaterThan(0);
    assertPrototypeIntact();
  });

  it('T-ENG-063 R-ENG-089: an unknown type or an unknown field at any depth is bad_command', () => {
    for (const cmd of validCommands()) {
      const raw = clone(cmd) as unknown as Record<string, unknown>;
      expect(() => parseCommand(raw)).not.toThrow();
      expect(errCode(() => parseCommand({ ...raw, foo: 1 }))).toBe('bad_command');
      expect(errCode(() => parseCommand({ ...raw, type: 'Withdraw' }))).toBe('bad_command');
    }
    const bid = clone(validCommands()[4]) as unknown as { audit: Record<string, unknown> };
    bid.audit['foo'] = 1;
    expect(errCode(() => parseCommand(bid))).toBe('bad_command');
    const lot = clone(validCommands()[1]) as unknown as {
      lot: { softClose: Record<string, unknown> };
    };
    lot.lot.softClose['foo'] = 1;
    expect(errCode(() => parseCommand(lot))).toBe('bad_command');
  });
});

describe('command parsing security (R-ENG-006)', () => {
  it('T-ENG-006 R-ENG-006: forbidden keys at every depth are bad_command and pollute nothing', () => {
    for (const key of FORBIDDEN) {
      for (const cmd of validCommands()) {
        const json = JSON.stringify(cmd);
        // Inject the key as an own property of the root and of every nested object.
        const rootProbe = JSON.parse(`{"${key}":{"polluted":true},${json.slice(1)}`) as unknown;
        expect(errCode(() => parseCommand(rootProbe))).toBe('bad_command');
        const nested = JSON.parse(json, (_k, v: unknown) =>
          typeof v === 'object' && v !== null && !Array.isArray(v)
            ? Object.defineProperty({ ...v }, key, {
                value: { polluted: true },
                enumerable: true,
                writable: true,
                configurable: true,
              })
            : v,
        ) as unknown;
        expect(errCode(() => parseCommand(nested))).toBe('bad_command');
      }
    }
    assertPrototypeIntact();
  });

  it('T-ENG-006 R-ENG-006: caller supplied ids named like prototype members change no state', () => {
    const s = fuzzBase();
    for (const key of FORBIDDEN) {
      const raw = clone(validCommands()[2]) as unknown as Record<string, unknown>;
      raw['bidderId'] = key;
      expect(errCode(() => parseCommand(raw))).toBe('bad_command');
      // Bypassing the parser must still fail in decide before any map is keyed by the id.
      const cmd = { ...raw, auctionId: AU, commandId: nextId() } as unknown as Command;
      expect(errCode(() => decide(s, cmd))).toBe('bad_id');
    }
    assertPrototypeIntact();
  });

  it('T-ENG-006 R-ENG-006: a JSON body with __proto__ as an own key does not reach the prototype', () => {
    const body = JSON.parse('{"__proto__":{"polluted":true},"type":"Tick"}') as unknown;
    expect(errCode(() => parseCommand(body))).toBe('bad_command');
    assertPrototypeIntact();
  });
});

describe('command parsing limits (R-ENG-007)', () => {
  const bidCmd = (transcript: string): Command =>
    mk(200, {
      type: 'PlaceBid',
      lotId: L1,
      bidderId: A,
      amountCents: 1500,
      source: 'manual',
      audit: { transcript },
    });

  it('T-ENG-007 R-ENG-007: transcript over 2000 chars is limit_exceeded, 2000 is accepted', () => {
    const s = fuzzBase();
    expect(errCode(() => decide(s, bidCmd('x'.repeat(LIMITS.transcript + 1))))).toBe(
      'limit_exceeded',
    );
    expect(decide(s, bidCmd('x'.repeat(LIMITS.transcript))).outcome.kind).toBe('accepted');
    // The same through the untrusted parser path.
    const raw = clone(bidCmd('x'.repeat(LIMITS.transcript + 1)));
    const parsed = parseCommand(raw);
    expect(errCode(() => decide(s, parsed))).toBe('limit_exceeded');
  });

  it('T-ENG-007 R-ENG-007: title over 120 chars is limit_exceeded, 120 is accepted', () => {
    const create = (title: string): Command => mk(0, { type: 'CreateAuction', title, config: {} });
    expect(errCode(() => decide(initialState, create('t'.repeat(LIMITS.title + 1))))).toBe(
      'limit_exceeded',
    );
    expect(decide(initialState, create('t'.repeat(LIMITS.title))).outcome.kind).toBe('accepted');
  });

  it('T-ENG-007 R-ENG-007: holdRef over 128 chars is limit_exceeded, 128 is accepted', () => {
    const s = fuzzBase();
    const reg = (holdRef: string): Command =>
      mk(150, { type: 'RegisterBidder', bidderId: id('BD'), ceilingCents: 5000, holdRef });
    expect(errCode(() => decide(s, reg('h'.repeat(LIMITS.holdRef + 1))))).toBe('limit_exceeded');
    expect(decide(s, reg('h'.repeat(LIMITS.holdRef))).outcome.kind).toBe('accepted');
  });

  it('T-ENG-007 R-ENG-007: free-text fields over their bound are limit_exceeded when parsed', () => {
    const long = 'z'.repeat(LIMITS.text + 1);
    const cmds = validCommands();
    const hammer = clone(cmds[6]) as unknown as Record<string, unknown>;
    hammer['actor'] = long;
    expect(errCode(() => parseCommand(hammer))).toBe('limit_exceeded');
    const abort = clone(cmds[9]) as unknown as Record<string, unknown>;
    abort['reason'] = long;
    expect(errCode(() => parseCommand(abort))).toBe('limit_exceeded');
    const complete = clone(cmds[10]) as unknown as Record<string, unknown>;
    complete['ref'] = long;
    expect(errCode(() => parseCommand(complete))).toBe('limit_exceeded');
  });

  it('T-ENG-007 R-ENG-007: the 201st lot and the 1001st bidder fail, the 200th and 1000th succeed', () => {
    let s = run(initialState, mk(0, { type: 'CreateAuction', title: 'Big', config: {} })).state;
    for (let i = 1; i <= LIMITS.lots; i += 1) {
      s = run(
        s,
        mk(0, { type: 'AddLot', lot: lotConfig(id(`M${i.toString(16).toUpperCase()}`)) }),
      ).state;
    }
    expect(s.lotOrder).toHaveLength(LIMITS.lots);
    const extra = mk(0, { type: 'AddLot', lot: lotConfig(id('MFFFF')) });
    expect(errCode(() => decide(s, extra))).toBe('limit_exceeded');
    for (let i = 1; i <= LIMITS.bidders; i += 1) {
      s = run(
        s,
        mk(0, {
          type: 'RegisterBidder',
          bidderId: id(`B${i.toString(16).toUpperCase()}`),
          ceilingCents: 1000,
        }),
      ).state;
    }
    const more = mk(0, { type: 'RegisterBidder', bidderId: id('BFFFF'), ceilingCents: 1000 });
    expect(errCode(() => decide(s, more))).toBe('limit_exceeded');
  });

  it('T-ENG-007 R-ENG-007: the 20001st recorded bid on a lot is rejected limit_exceeded', () => {
    const s = fuzzBase();
    const lot = s.lots[L1] as LotState;
    const filler = (n: number): LotState['bids'] =>
      Array.from({ length: n }, (_v, i) => ({
        bidId: `f${i}`,
        bidderId: 'filler',
        amountCents: 0,
        at: 0,
        seq: i,
        status: 'struck' as const,
      }));
    const withBids = (n: number): AuctionState => ({
      ...s,
      lots: { ...s.lots, [L1]: { ...lot, bids: filler(n) } },
    });
    const place = mk(200, {
      type: 'PlaceBid',
      lotId: L1,
      bidderId: A,
      amountCents: 1500,
      source: 'manual',
      audit: {},
    });
    const atLimit = decide(withBids(LIMITS.bidsPerLot), place);
    expect(atLimit.outcome).toEqual({ kind: 'rejected', reason: 'limit_exceeded' });
    const below = decide(withBids(LIMITS.bidsPerLot - 1), place);
    expect(below.outcome.kind).toBe('accepted');
  });
});
