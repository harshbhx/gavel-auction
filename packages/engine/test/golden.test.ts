import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands.js';
import { EngineError } from '../src/errors.js';
import { rank } from '../src/rules/ranking.js';
import { initialState } from '../src/state.js';
import type { AuctionState } from '../src/state.js';
import { loadFixtures } from '../src/testing/fixtures.js';
import type { Fixture, Step } from '../src/testing/fixtures.js';
import type { IncrementRule, Ulid } from '../src/types.js';
import { L1, id, mk, run } from './decide-helpers.js';

/**
 * R-ENG-112, R-ENG-113: every golden fixture is replayed against the decide/evolve
 * core and compared with `expect`, the same way reference/python/golden_runner.py does.
 */
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'golden');

interface Observed {
  winner: string | null;
  price: number;
  ranking: Array<[string, number]>;
  rejects: string[];
  endsAt: number;
}

function incrementOf(fx: Fixture): IncrementRule {
  const ladder = (fx.config as { ladder?: Array<{ fromCents: number; incrementCents: number }> })
    .ladder;
  return ladder === undefined ? { flatCents: fx.config.minIncrement ?? 1 } : { ladder };
}

/** Python reject codes and engine reasons differ for a few cases; both map to one name. */
function rejectName(code: string): string {
  return code === 'lot_done' || code === 'lot_not_open' ? 'closed' : code;
}

export function play(fx: Fixture): Observed {
  const ids = new Map<string, Ulid>();
  const names = new Map<string, string>();
  const idOf = (name: string): Ulid => {
    let u = ids.get(name);
    if (u === undefined) {
      u = id(`B${(ids.size + 1).toString(16).toUpperCase()}`);
      ids.set(name, u);
      names.set(u, name);
    }
    return u;
  };
  const cfg = fx.config;
  const sealed = cfg.mode === 'second_price';
  let s: AuctionState = initialState;
  const rejects: string[] = [];
  let winner: string | null = null;
  let price = 0;

  const step = (at: number, body: Parameters<typeof mk>[1]): void => {
    const cmd: Command = mk(Math.max(at, s.head.at), body);
    const r = run(s, cmd);
    s = r.state;
    for (const e of r.entries) {
      if (e.type === 'LOT_HAMMERED') {
        winner = names.get(e.payload.winnerId) ?? e.payload.winnerId;
        price = e.payload.priceCents;
      }
    }
    if (r.result.outcome.kind === 'rejected') rejects.push(rejectName(r.result.outcome.reason));
  };
  const attempt = (at: number, body: Parameters<typeof mk>[1]): void => {
    try {
      step(at, body);
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      rejects.push(rejectName(e.code));
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
    if (lot?.status === 'OPEN' && lot.endsAt !== null && at >= lot.endsAt) {
      step(at, { type: 'Tick' });
    }
  };

  for (const st of fx.steps as Step[]) {
    const who = st.bidder === undefined ? undefined : idOf(st.bidder);
    switch (st.op) {
      case 'register':
        attempt(st.at, {
          type: 'RegisterBidder',
          bidderId: idOf(st.bidder ?? ''),
          ceilingCents: st.ceiling ?? 0,
        });
        break;
      case 'bid':
        tick(st.at);
        if (s.lots[L1]?.status !== 'OPEN') {
          rejects.push('closed');
        } else {
          attempt(st.at, {
            type: 'PlaceBid',
            lotId: L1,
            bidderId: who ?? idOf(''),
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
          disqualifiedBidderId: who ?? idOf(''),
          reason: 'golden',
        });
        break;
      case 'revoke':
        attempt(st.at, { type: 'RevokeCeiling', bidderId: who ?? idOf(''), reason: 'other' });
        break;
      case 'complete': {
        const lot = s.lots[L1];
        if (lot === undefined || lot.winnerId === null || lot.priceCents === null) {
          rejects.push('cannot_complete');
        } else {
          attempt(st.at, {
            type: 'CompleteLot',
            lotId: L1,
            bidderId: lot.winnerId as Ulid,
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
    ranking: rank(lot?.bids ?? []).map((r) => [names.get(r.bidderId) ?? r.bidderId, r.amountCents]),
    rejects,
    endsAt: lot?.endsAt ?? 0,
  };
}

const fixtures = loadFixtures(GOLDEN);

describe('golden fixtures against the TypeScript engine', () => {
  it('T-ENG-081 R-ENG-112 loads the shared fixtures', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures.map((f) => [f.name, f] as const))(
    'T-ENG-081 R-ENG-113 golden fixture %s',
    (_name, fx) => {
      const got = play(fx);
      const want = fx.expect;
      for (const key of Object.keys(want) as Array<keyof typeof want>) {
        expect(got[key], key).toEqual(want[key]);
      }
    },
  );

  it('T-ENG-081 R-ENG-113 reports a difference when a result changes', () => {
    const fx: Fixture = {
      name: 'x',
      parity: true,
      config: { mode: 'english', endTs: 10000 },
      steps: [
        { op: 'register', at: 0, bidder: 'a', ceiling: 500 },
        { op: 'bid', at: 1000, bidder: 'a', amount: 100 },
        { op: 'hammer', at: 10000 },
      ],
      expect: { price: 101 },
    };
    expect(play(fx).price).toBe(100);
  });
});
