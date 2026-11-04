import type { Command } from '../commands.js';
import { EngineError } from '../errors.js';
import type { LedgerEvent } from '../events.js';
import { currentPrice as basicPrice } from '../rules/pricing-basic.js';
import type { PricingLot } from '../rules/pricing-basic.js';
import { currentPrice as proxyPrice } from '../rules/pricing-proxy.js';
import { rank } from '../rules/ranking.js';
import type { BidRecord, RankedBid } from '../rules/ranking.js';
import { extension } from '../rules/softclose.js';
import { assertBidIds, isValidAmount, validateBid } from '../rules/validate-bid.js';
import type { AuctionState, LotState } from '../state.js';
import { LIMITS } from '../types.js';
import type { Ulid } from '../types.js';
import { assertNotInPast } from './setup.js';
import type { DecideResult } from './setup.js';

export type PlaceBidCommand = Extract<Command, { type: 'PlaceBid' }>;

const SOURCES: readonly string[] = ['voice', 'manual', 'qr'];
const AMOUNT_RAW_MAX = 40;

/** R-ENG-083, R-ENG-084: shape checks that do not depend on state. */
function assertBidShape(cmd: PlaceBidCommand): void {
  if (!SOURCES.includes(cmd.source)) throw new EngineError('bad_command', 'source');
  const a = cmd.audit;
  if (a.confidenceBps !== undefined) {
    if (!Number.isSafeInteger(a.confidenceBps) || a.confidenceBps < 0 || a.confidenceBps > 10000) {
      throw new EngineError('bad_command', 'audit.confidenceBps');
    }
  }
  if (a.transcript !== undefined && a.transcript.length > LIMITS.transcript) {
    throw new EngineError('limit_exceeded', 'transcript');
  }
  for (const k of ['audioStartMs', 'audioEndMs', 'clientTs'] as const) {
    const v = a[k];
    if (v !== undefined && (!Number.isSafeInteger(v) || Object.is(v, -0))) {
      throw new EngineError('bad_command', `audit.${k}`);
    }
  }
  for (const k of ['utteranceId', 'parserVersion'] as const) {
    const v = a[k];
    if (v !== undefined && v.length > LIMITS.text) throw new EngineError('limit_exceeded', k);
  }
}

/** Public price after a bid: sealed lots show none while open (R-ENG-086). */
function priceOf(lot: PricingLot, ranked: readonly RankedBid[]): number | null {
  if (lot.mode === 'english') return basicPrice(lot, ranked);
  if (lot.mode === 'proxy') return proxyPrice(lot, ranked);
  return null;
}

function pricingLot(lot: LotState): PricingLot | null {
  const c = lot.config;
  return c === null ? null : { mode: c.mode, reserveCents: c.reserveCents, increment: c.increment };
}

/**
 * Decides PlaceBid (R-ENG-031..033, R-ENG-038, R-ENG-081..083, R-ENG-085, R-ENG-086).
 * `clientTs` is stored in the audit record only; ordering uses the server `at`
 * and `seq` (R-ENG-085). The bid id is the command id.
 */
export function decidePlaceBid(state: AuctionState, cmd: PlaceBidCommand): DecideResult {
  assertBidIds(cmd);
  assertBidShape(cmd);
  assertNotInPast(state, cmd);
  if (state.auctionId === null) throw new EngineError('bad_command', 'auction not created');
  if (state.closed) throw new EngineError('auction_closed');
  const lot = state.lots[cmd.lotId];
  if (lot === undefined) throw new EngineError('bad_command', 'unknown lot');
  if (lot.status === 'DONE') throw new EngineError('lot_done');
  const check = validateBid(state, lot, cmd);

  if (!check.ok) {
    const events: LedgerEvent[] = [];
    if (lot.status === 'OPEN' && lot.endsAt !== null && cmd.at >= lot.endsAt) {
      events.push({ type: 'LOT_CLOSING', payload: { lotId: cmd.lotId, reason: 'deadline' } });
    }
    const safe = isValidAmount(cmd.amountCents);
    events.push({
      type: 'BID_REJECTED',
      payload: {
        bidId: cmd.commandId,
        lotId: cmd.lotId,
        bidderId: cmd.bidderId,
        amountCents: safe ? cmd.amountCents : null,
        ...(safe ? {} : { amountRaw: String(cmd.amountCents).slice(0, AMOUNT_RAW_MAX) }),
        source: cmd.source,
        audit: cmd.audit,
        reason: check.reason,
        detail: check.detail,
      },
    });
    return { events, outcome: { kind: 'rejected', reason: check.reason } };
  }

  const pl = pricingLot(lot);
  if (pl === null || lot.endsAt === null) throw new EngineError('lot_not_open');
  const before = rank(lot.bids);
  const record: BidRecord = {
    bidId: cmd.commandId,
    bidderId: cmd.bidderId,
    amountCents: cmd.amountCents,
    at: cmd.at,
    seq: state.head.seq + 1,
    status: 'active',
  };
  const after = rank([...lot.bids, record]);
  const ext = extension(lot, cmd.at);
  const sealed = pl.mode === 'second_price';
  const mine = after.find((r) => r.bidderId === cmd.bidderId);
  const events: LedgerEvent[] = [
    {
      type: 'BID_RECORDED',
      payload: {
        bidId: cmd.commandId,
        lotId: cmd.lotId,
        bidderId: cmd.bidderId,
        amountCents: cmd.amountCents,
        source: cmd.source,
        audit: cmd.audit,
        priceBefore: priceOf(pl, before),
        priceAfter: priceOf(pl, after),
        // Sealed lots reveal neither the leader nor the rank before the hammer (R-ENG-086).
        leaderBefore: sealed ? null : ((before[0]?.bidderId as Ulid | undefined) ?? null),
        leaderAfter: sealed ? null : ((after[0]?.bidderId as Ulid | undefined) ?? null),
        rank: sealed ? null : (mine?.rank ?? after.length),
        endsAtBefore: lot.endsAt,
        endsAtAfter: ext.endsAt,
      },
    },
  ];
  if (ext.extended) {
    events.push({
      type: 'END_EXTENDED',
      payload: {
        lotId: cmd.lotId,
        endsAtBefore: lot.endsAt,
        endsAtAfter: ext.endsAt,
        extensions: lot.extensions + 1,
        triggerBidId: cmd.commandId,
      },
    });
  }
  return { events, outcome: { kind: 'accepted' } };
}
