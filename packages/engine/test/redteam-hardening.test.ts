import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/canonical.js';
import { parseCommand } from '../src/commands.js';
import { validateLotConfig } from '../src/config.js';
import { decide } from '../src/decide/index.js';
import type { LedgerEntry, LedgerEvent } from '../src/events.js';
import { genesisHead, sealBatch } from '../src/ledger/chain.js';
import { ChainError, replay, stateDigest } from '../src/replay.js';
import { evolve } from '../src/evolve.js';
import { extension } from '../src/rules/softclose.js';
import { initialState, newLot } from '../src/state.js';
import type { Ulid } from '../src/types.js';
import {
  A,
  AU,
  B,
  L1,
  bid,
  errCode,
  id,
  lotConfig,
  mk,
  open,
  run,
  scene,
} from './decide-helpers.js';

describe('red-team hardening (engine)', () => {
  it('ENG-RT-04: a hard-close cap that changes nothing is not an extension', () => {
    const cfg = lotConfig(L1, {
      softClose: { windowMs: 30000, extensionMs: 30000, maxExtensions: 3, hardCloseMs: 120000 },
    });
    const lot = { ...newLot(L1, cfg), status: 'OPEN' as const, openedAt: 0, endsAt: 120000 };
    expect(extension(lot, 119999)).toEqual({ endsAt: 120000, extended: false });
  });

  it('ENG-RT-05: a duplicate reports the original outcome', () => {
    const s = open(scene(), L1);
    const cmd = mk(
      200,
      {
        type: 'PlaceBid',
        lotId: L1,
        bidderId: A,
        amountCents: 500,
        source: 'manual',
        audit: {},
      },
      id('D4P1'),
    );
    const first = run(s, cmd);
    expect(first.result.outcome).toEqual({ kind: 'rejected', reason: 'below_reserve' });
    expect(decide(first.state, cmd).outcome).toEqual({
      kind: 'duplicate',
      original: { kind: 'rejected', reason: 'below_reserve' },
    });
    const ok = mk(
      300,
      {
        type: 'PlaceBid',
        lotId: L1,
        bidderId: A,
        amountCents: 1000,
        source: 'manual',
        audit: {},
      },
      id('D4P2'),
    );
    const second = run(first.state, ok);
    expect(decide(second.state, ok).outcome).toEqual({
      kind: 'duplicate',
      original: { kind: 'accepted' },
    });
  });

  it('ENG-RT-06: changed lot config, hold or actor under the same id is a conflict', () => {
    let s = scene();
    const add = mk(5, { type: 'AddLot', lot: lotConfig(id('M9')) }, id('ADD9'));
    s = run(s, add).state;
    const changed = mk(
      5,
      { type: 'AddLot', lot: lotConfig(id('M9'), { reserveCents: 1 }) },
      id('ADD9'),
    );
    expect(errCode(() => decide(s, changed))).toBe('command_conflict');
    const reg = mk(
      6,
      { type: 'RegisterBidder', bidderId: id('BZ'), ceilingCents: 5000, holdRef: 'H1' },
      id('REG9'),
    );
    s = run(s, reg).state;
    const regChanged = mk(
      6,
      { type: 'RegisterBidder', bidderId: id('BZ'), ceilingCents: 5000, holdRef: 'H2' },
      id('REG9'),
    );
    expect(errCode(() => decide(s, regChanged))).toBe('command_conflict');
    s = open(s, L1);
    const ham = mk(10200, { type: 'Hammer', lotId: L1, actor: 'host-1', early: true }, id('HAM9'));
    s = run(s, ham).state;
    const hamChanged = mk(
      10200,
      { type: 'Hammer', lotId: L1, actor: 'host-2', early: true },
      id('HAM9'),
    );
    expect(errCode(() => decide(s, hamChanged))).toBe('command_conflict');
  });

  it('ENG-RT-13 ENG-RT-18: a bid reusing a body-less command id conflicts', () => {
    const s0 = open(scene(), L1);
    const tickId = id('TCK1');
    const s = run(s0, mk(10100, { type: 'Tick' }, tickId)).state;
    const reuse = mk(
      10100,
      { type: 'PlaceBid', lotId: L1, bidderId: A, amountCents: 1000, source: 'manual', audit: {} },
      tickId,
    );
    expect(errCode(() => decide(s, reuse))).toBe('command_conflict');
  });

  it('ENG-RT-07: a -0 or zero amount is a recordable rejection', () => {
    const s = open(scene(), L1);
    for (const amount of [-0, 0, -5, 9e15]) {
      const r = bid(s, 200, A, amount, L1, { commandId: id(`Z${Math.abs(amount) % 1000}`) });
      expect(r.result.outcome).toMatchObject({ kind: 'rejected' });
      expect(r.entries[0]?.payload).toMatchObject({ amountCents: null });
    }
    const parsed: unknown = JSON.parse(JSON.stringify(mkBid()).replace('1500', '-0'));
    expect(() => parseCommand(parsed)).toThrow();
  });

  it('ENG-RT-08: replay with an expected head detects a truncated tail', () => {
    const events: LedgerEvent[] = [
      { type: 'AUCTION_CREATED', payload: { title: 'Gala', config: {} } },
      { type: 'LOT_ADDED', payload: { lotId: L1 } },
    ];
    const entries = sealBatch(events, genesisHead(AU), 1, null);
    const head = entries[1] as LedgerEntry;
    expect(() =>
      replay(entries.slice(0, 1), undefined, { seq: head.seq, hash: head.hash }),
    ).toThrow(ChainError);
    expect(() => replay(entries, undefined, { seq: head.seq, hash: head.hash })).not.toThrow();
  });

  it('ENG-RT-09: a second AUCTION_CREATED does not overwrite the auction', () => {
    const s = scene();
    const again = {
      v: 1,
      auctionId: id('AAB'),
      seq: s.head.seq + 1,
      at: s.head.at,
      type: 'AUCTION_CREATED',
      cmd: null,
      payload: { title: 'Evil', config: { maxCeilingCents: 5 } },
      prev: 'p',
      hash: 'h',
    } as unknown as LedgerEntry;
    const next = evolve(s, again);
    expect(next.auctionId).toBe(s.auctionId);
    expect(next.title).toBe(s.title);
    expect(next.config).toEqual(s.config);
  });

  it('ENG-RT-10: canonical JSON escapes non-ASCII like Python ensure_ascii', () => {
    const eacute = String.fromCharCode(0xe9);
    const smile = String.fromCodePoint(0x1f600);
    const del = String.fromCharCode(0x7f);
    expect(canonicalize({ k: `caf${eacute} ${smile} ${del}` })).toBe(
      '{"k":"caf\\u00e9 \\ud83d\\ude00 \\u007f"}',
    );
    expect(canonicalize({ [eacute]: 1 })).toBe('{"\\u00e9":1}');
  });

  it('ENG-RT-13: envelope checks run for every command type', () => {
    const s = scene();
    expect(
      errCode(() =>
        decide(s, mk(1, { type: 'RegisterBidder', bidderId: 'alice' as Ulid, ceilingCents: 5000 })),
      ),
    ).toBe('bad_id');
    expect(errCode(() => decide(s, mk(Number.NaN, { type: 'Tick' })))).toBe('bad_time');
    expect(errCode(() => decide(s, { ...mk(1, { type: 'Tick' }), auctionId: id('AAB') }))).toBe(
      'bad_command',
    );
    expect(
      errCode(() => decide(s, { ...mk(1, { type: 'Tick' }), commandId: '__proto__' as Ulid })),
    ).toBe('bad_id');
  });

  it('ENG-RT-14: free-text audit and actor fields are bounded', () => {
    const s = open(scene(), L1);
    const long = 'x'.repeat(129);
    expect(errCode(() => bid(s, 200, A, 1000, L1, { audit: { utteranceId: long } }))).toBe(
      'limit_exceeded',
    );
    expect(
      errCode(() => decide(s, mk(300, { type: 'Hammer', lotId: L1, actor: long, early: true }))),
    ).toBe('limit_exceeded');
    expect(() => parseCommand({ ...mkBid(), audit: { parserVersion: long } })).toThrow();
  });

  it('ENG-RT-12: sealed lots record no leader or rank before the hammer', () => {
    const s = open(scene({ lots: [lotConfig(L1, { mode: 'second_price' })] }), L1);
    const r = bid(s, 200, B, 2000);
    expect(r.entries[0]?.payload).toMatchObject({
      leaderBefore: null,
      leaderAfter: null,
      rank: null,
    });
    const over = bid(s, 200, B, 99000);
    expect(over.entries[0]?.payload).toMatchObject({ reason: 'over_ceiling', detail: {} });
  });

  it('ENG-RT-17: reserve and increments are bounded', () => {
    const base = { lotId: L1, title: 'x', mode: 'english', reserveCents: 1000, durationMs: 60000 };
    expect(validateLotConfig({ ...base, reserveCents: 2 ** 53 - 1 }).ok).toBe(false);
    expect(validateLotConfig({ ...base, increment: { flatCents: 2 ** 53 - 1 } }).ok).toBe(false);
    expect(validateLotConfig({ ...base, reserveCents: 100_000_000 }).ok).toBe(true);
    const s = scene();
    const big = mk(9, { type: 'AddLot', lot: lotConfig(id('M8'), { reserveCents: 100_001 }) });
    expect(errCode(() => decide(s, big))).toBe('bad_command');
  });

  it('ENG-RT-03: replay of a long ledger matches the live fold and stays fast', () => {
    const n = 3000;
    const events: LedgerEvent[] = [
      { type: 'AUCTION_CREATED', payload: { title: 'T', config: {} } },
    ];
    let head = genesisHead(AU);
    const entries: LedgerEntry[] = [];
    for (let i = 0; i < n; i++) {
      const ev: LedgerEvent = events[i] ?? {
        type: 'LOT_CLOSING',
        payload: { lotId: L1, reason: 'deadline' },
      };
      const [e] = sealBatch([ev], head, 1000 + i, id(`K${i.toString(36).toUpperCase()}`));
      if (e === undefined) throw new Error('seal');
      entries.push(e);
      head = { auctionId: AU, seq: e.seq, hash: e.hash };
    }
    const t0 = Date.now();
    const replayed = replay(entries);
    expect(Date.now() - t0).toBeLessThan(5000);
    const live = entries.reduce(evolve, initialState);
    expect(stateDigest(replayed)).toBe(stateDigest(live));
  });
});

function mkBid(): Record<string, unknown> {
  return {
    commandId: '01JC0000000000000000000A01',
    at: 1000,
    auctionId: '01JC0000000000000000000001',
    type: 'PlaceBid',
    lotId: '01JC00000000000000000002M1',
    bidderId: '01JC0000000000000000000BD2',
    amountCents: 1500,
    source: 'manual',
    audit: {},
  };
}
