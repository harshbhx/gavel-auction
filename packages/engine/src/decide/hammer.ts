import type { Command } from '../commands.js';
import { EngineError } from '../errors.js';
import type { LedgerEvent, RankedEntry } from '../events.js';
import { candidatesOf, priceFor } from '../rules/candidates.js';
import { assertWithinCeiling } from '../rules/pricing-basic.js';
import type { PricingLot } from '../rules/pricing-basic.js';
import { rank } from '../rules/ranking.js';
import { available } from '../rules/exposure.js';
import type { AuctionState } from '../state.js';
import type { Ulid } from '../types.js';
import { assertNotInPast } from './setup.js';
import type { DecideResult } from './setup.js';

export type TickCommand = Extract<Command, { type: 'Tick' }>;
export type HammerCommand = Extract<Command, { type: 'Hammer' }>;

function openLotId(state: AuctionState): Ulid | null {
  for (const id of state.lotOrder) {
    if (state.lots[id]?.status === 'OPEN') return id;
  }
  return null;
}

/** R-ENG-053: the active lot's `endsAt` while OPEN, else null. */
export function nextDeadline(state: AuctionState): number | null {
  const id = openLotId(state);
  const lot = id === null ? undefined : state.lots[id];
  // A paused clock has no deadline until the lot resumes.
  return lot === undefined || lot.pausedRemainingMs !== undefined ? null : (lot.endsAt ?? null);
}

function assertActive(state: AuctionState): void {
  if (state.auctionId === null) throw new EngineError('bad_command', 'auction not created');
  if (state.closed) throw new EngineError('auction_closed');
}

/** Decides Tick (R-ENG-053): closes the open lot at its deadline, otherwise nothing. */
export function decideTick(state: AuctionState, cmd: TickCommand): DecideResult {
  assertNotInPast(state, cmd);
  assertActive(state);
  const id = openLotId(state);
  const endsAt = nextDeadline(state);
  if (id === null || endsAt === null || cmd.at < endsAt) {
    return { events: [], outcome: { kind: 'noop' } };
  }
  return {
    events: [{ type: 'LOT_CLOSING', payload: { lotId: id, reason: 'deadline' } }],
    outcome: { kind: 'accepted' },
  };
}

/**
 * Decides Hammer (R-ENG-047..050, R-ENG-052, R-ENG-068). Valid on a CLOSING lot,
 * or on an OPEN lot with `early:true`, which first appends LOT_CLOSING(early).
 */
export function decideHammer(state: AuctionState, cmd: HammerCommand): DecideResult {
  assertNotInPast(state, cmd);
  assertActive(state);
  const lot = state.lots[cmd.lotId];
  if (lot === undefined) throw new EngineError('bad_command', 'unknown lot');
  if (lot.status === 'DONE') throw new EngineError('lot_done');
  if (lot.pausedRemainingMs !== undefined) throw new EngineError('cannot_hammer', 'paused');
  const early = lot.status === 'OPEN' && cmd.early === true;
  if (lot.status !== 'CLOSING' && !early) throw new EngineError('cannot_hammer', lot.status);
  const cfg = lot.config;
  if (cfg === null || lot.endsAt === null) throw new EngineError('cannot_hammer', 'no config');

  const events: LedgerEvent[] = [];
  if (early) events.push({ type: 'LOT_CLOSING', payload: { lotId: cmd.lotId, reason: 'early' } });
  const ranked = rank(lot.bids);
  const winner = ranked[0];
  if (winner === undefined) {
    events.push({
      type: 'LOT_UNSOLD',
      payload: { lotId: cmd.lotId, reason: 'no_bids', actor: cmd.actor },
    });
    return { events, outcome: { kind: 'accepted' } };
  }
  const pl: PricingLot = {
    mode: cfg.mode,
    reserveCents: cfg.reserveCents,
    increment: cfg.increment,
  };
  const price = priceFor(pl, ranked);
  if (price === null) throw new EngineError('cannot_hammer', 'no price');
  assertWithinCeiling(price, available(state, winner.bidderId, cmd.lotId));
  const entries: RankedEntry[] = ranked.map((r) => ({
    bidderId: r.bidderId as Ulid,
    amountCents: r.amountCents,
    at: r.at,
    seq: r.seq,
  }));
  // The closing entry is in this batch for an early hammer, else it is the lot's own
  // LOT_CLOSING, which other entries may follow before the hammer (R12-E11).
  const closedAtSeq = early ? state.head.seq + 1 : (lot.closingSeq ?? state.head.seq);
  events.push({
    type: 'LOT_HAMMERED',
    payload: {
      lotId: cmd.lotId,
      winnerId: winner.bidderId as Ulid,
      priceCents: price,
      mode: cfg.mode,
      ranking: entries,
      candidates: candidatesOf(pl, ranked, state.config.maxFallbackDepth),
      endsAt: lot.endsAt,
      extensions: lot.extensions,
      closedAtSeq,
      actor: cmd.actor,
    },
  });
  return { events, outcome: { kind: 'accepted' } };
}
