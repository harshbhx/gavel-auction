import type { Command } from '../src/commands.js';
import { EngineError } from '../src/errors.js';
import type { SettlementState } from '../src/events.js';
import { rank } from '../src/rules/ranking.js';
import { initialState } from '../src/state.js';
import type { AuctionState } from '../src/state.js';
import type { Fixture, Step } from '../src/testing/fixtures.js';
import type { IncrementRule, Ulid } from '../src/types.js';
import { L1, id, mk, run } from './decide-helpers.js';

/**
 * Replays a golden fixture (or a differential scenario) against the decide/evolve core and
 * returns the observed result in the shape of a fixture `expect`.
 */
export interface Observed {
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

/**
 * The reference engine has one code, `closed`, for a bid on a lot past its deadline or already
 * hammered. The TypeScript engine reports that as `lot_not_open`. Every other code, including
 * `lot_done`, is compared as the engine reports it.
 */
function rejectName(code: string): string {
  return code === 'lot_not_open' ? 'closed' : code;
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
      } else if (e.type === 'FALLBACK_PROMOTED') {
        winner = names.get(e.payload.to) ?? e.payload.to;
        price = e.payload.priceCents;
      } else if (e.type === 'LOT_UNSOLD' || e.type === 'LOT_ABORTED') {
        winner = null;
        price = 0;
      }
    }
    if (r.result.outcome.kind === 'rejected') rejects.push(rejectName(r.result.outcome.reason));
  };
  // The capture path a lot takes before CompleteLot (R-ENG-066). The fixtures model the capture
  // as the complete step itself, so the winner's path is recorded silently before it.
  const CAPTURE_PATH: readonly (readonly [SettlementState, SettlementState])[] = [
    ['HELD', 'BIDDING'],
    ['BIDDING', 'WINNER_SELECTED'],
    ['WINNER_SELECTED', 'CAPTURING'],
    ['CAPTURING', 'CAPTURED'],
  ];
  const recordCapture = (at: number): void => {
    const lot = s.lots[L1];
    if (lot === undefined || lot.winnerId === null || lot.priceCents === null) return;
    if (lot.settlement !== 'HELD') return;
    for (const [from, to] of CAPTURE_PATH) {
      try {
        const r = run(
          s,
          mk(Math.max(at, s.head.at), {
            type: 'RecordSettlement',
            lotId: L1,
            from,
            to,
            ref: 'golden',
          }),
        );
        if (r.result.outcome.kind === 'rejected') return;
        s = r.state;
      } catch (e) {
        if (!(e instanceof EngineError)) throw e;
        return;
      }
    }
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
        // The engine decides every bid, including those past the deadline or after the hammer.
        attempt(st.at, {
          type: 'PlaceBid',
          lotId: L1,
          bidderId: who ?? idOf(''),
          amountCents: st.amount ?? 0,
          source: 'manual',
          audit: {},
        });
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
      case 'complete':
        recordCapture(st.at);
        // Bidder and amount come from the fixture so a wrong winner or amount can be presented.
        attempt(st.at, {
          type: 'CompleteLot',
          lotId: L1,
          bidderId: who ?? idOf(''),
          capturedCents: st.amount ?? 0,
          ref: 'golden',
        });
        break;
      case 'abort':
        attempt(st.at, { type: 'AbortLot', lotId: L1, reason: 'golden', actor: 'golden' });
        break;
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

/** The keys on which the observed result differs from what the fixture expects. */
export function differences(got: Observed, want: Fixture['expect']): string[] {
  return (Object.keys(want) as Array<keyof typeof want>).filter(
    (key) => JSON.stringify(got[key]) !== JSON.stringify(want[key]),
  );
}
