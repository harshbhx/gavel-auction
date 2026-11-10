import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands.js';
import { decideSetup } from '../src/decide/setup.js';
import type { SetupCommand } from '../src/decide/setup.js';
import { EngineError } from '../src/errors.js';
import { evolve } from '../src/evolve.js';
import type { LedgerEvent } from '../src/events.js';
import { initialState } from '../src/state.js';
import type { AuctionState } from '../src/state.js';
import type { LotConfig, Ulid } from '../src/types.js';
import { entriesFrom } from './entries.js';

const id = (s: string): Ulid => s.padStart(26, '0') as Ulid;
const AU = id('AAA');
const L1 = id('M1');
const A = id('A');

const base = { commandId: id('CMD'), auctionId: AU, at: 100 };
const lot: LotConfig = {
  lotId: L1,
  title: 'Vase',
  mode: 'english',
  reserveCents: 1000,
  increment: { flatCents: 100 },
  durationMs: 100000,
  softClose: { windowMs: 0, extensionMs: 0, maxExtensions: 3 },
  hammer: 'auto',
};

function apply(s: AuctionState, evs: LedgerEvent[], at = 50): AuctionState {
  return entriesFrom(evs.map((event) => ({ event, at }))).reduce(
    (st, e) => evolve(st, { ...e, seq: st.head.seq + 1 }),
    s,
  );
}

function run(s: AuctionState, c: SetupCommand): AuctionState {
  return apply(s, decideSetup(s, c).events, c.at);
}

const create: Command = { ...base, type: 'CreateAuction', title: 'Gala', config: {} };

function errCode(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof EngineError) return e.code;
    throw e;
  }
  return 'none';
}

describe('decideSetup', () => {
  it('creates an auction, adds a lot and registers a bidder', () => {
    let s = run(initialState, create as SetupCommand);
    s = run(s, { ...base, type: 'AddLot', lot });
    s = run(s, {
      ...base,
      type: 'RegisterBidder',
      bidderId: A,
      ceilingCents: 50000,
      holdRef: 'AUTH-1',
    });
    expect(s.title).toBe('Gala');
    expect(s.lotOrder).toEqual([L1]);
    expect(s.bidders[A]?.holdRef).toBe('AUTH-1');
  });

  it('T-ENG-032 R-ENG-041: re-register lower or equal fails, higher raises', () => {
    let s = run(initialState, create as SetupCommand);
    s = run(s, { ...base, type: 'RegisterBidder', bidderId: A, ceilingCents: 50000 });
    for (const c of [40000, 50000]) {
      expect(
        errCode(() =>
          decideSetup(s, { ...base, type: 'RegisterBidder', bidderId: A, ceilingCents: c }),
        ),
      ).toBe('cannot_lower_ceiling');
    }
    const r = decideSetup(s, { ...base, type: 'RegisterBidder', bidderId: A, ceilingCents: 60000 });
    expect(r.events).toEqual([
      { type: 'CEILING_RAISED', payload: { bidderId: A, fromCents: 50000, ceilingCents: 60000 } },
    ]);
    expect(apply(s, r.events).bidders[A]?.ceilingCents).toBe(60000);
  });

  it('R-ENG-040: out-of-range ceilings fail bad_ceiling', () => {
    const s = run(initialState, create as SetupCommand);
    for (const c of [99, 5_000_000_001]) {
      expect(
        errCode(() =>
          decideSetup(s, { ...base, type: 'RegisterBidder', bidderId: A, ceilingCents: c }),
        ),
      ).toBe('bad_ceiling');
    }
  });

  it('R-ENG-013: lotId is required only for holdScope lot', () => {
    let s = run(initialState, { ...create, config: { holdScope: 'lot' } } as SetupCommand);
    s = run(s, { ...base, type: 'AddLot', lot });
    expect(
      errCode(() =>
        decideSetup(s, { ...base, type: 'RegisterBidder', bidderId: A, ceilingCents: 5000 }),
      ),
    ).toBe('bad_command');
    const r = decideSetup(s, {
      ...base,
      type: 'RegisterBidder',
      bidderId: A,
      ceilingCents: 5000,
      lotId: L1,
    });
    expect(r.events[0]?.type).toBe('BIDDER_REGISTERED');
  });

  it('R-ENG-015: re-adding an opened lot fails lot_frozen', () => {
    let s = run(initialState, create as SetupCommand);
    s = run(s, { ...base, type: 'AddLot', lot });
    s = apply(s, [{ type: 'LOT_OPENED', payload: { lotId: L1, endsAt: 5000 } }]);
    expect(errCode(() => decideSetup(s, { ...base, type: 'AddLot', lot }))).toBe('lot_frozen');
  });

  it('R-ENG-004: a command older than the head throws time_regression', () => {
    const s = apply(
      initialState,
      [{ type: 'AUCTION_CREATED', payload: { title: 't', config: {} } }],
      500,
    );
    expect(errCode(() => decideSetup(s, { ...base, at: 499, type: 'AddLot', lot }))).toBe(
      'time_regression',
    );
  });

  it('rejects invalid configs and commands on a closed or missing auction', () => {
    expect(errCode(() => decideSetup(initialState, { ...base, type: 'AddLot', lot }))).toBe(
      'bad_command',
    );
    expect(
      errCode(() =>
        decideSetup(initialState, {
          ...base,
          type: 'CreateAuction',
          title: 't',
          config: { currency: 'EUR' as 'USD' },
        }),
      ),
    ).toBe('unsupported_currency');
    let s = run(initialState, create as SetupCommand);
    s = apply(s, [{ type: 'AUCTION_CLOSED', payload: { headHash: 'x' } }]);
    expect(errCode(() => decideSetup(s, { ...base, type: 'AddLot', lot }))).toBe('auction_closed');
  });

  it('ENG-RT-01: raising a ceiling carries the new holdRef', () => {
    let s = run(initialState, create as SetupCommand);
    s = run(s, {
      ...base,
      type: 'RegisterBidder',
      bidderId: A,
      ceilingCents: 10000,
      holdRef: 'H1',
    });
    const raise: SetupCommand = {
      ...base,
      commandId: id('RAISE'),
      type: 'RegisterBidder',
      bidderId: A,
      ceilingCents: 50000,
      holdRef: 'H2',
    };
    const r = decideSetup(s, raise);
    expect(r.events).toEqual([
      {
        type: 'CEILING_RAISED',
        payload: { bidderId: A, fromCents: 10000, ceilingCents: 50000, holdRef: 'H2' },
      },
    ]);
    expect(apply(s, r.events).bidders[A]?.holdRef).toBe('H2');
    const noHold: SetupCommand = { ...raise, holdRef: undefined };
    expect(errCode(() => decideSetup(s, noHold))).toBe('bad_command');
  });
});
