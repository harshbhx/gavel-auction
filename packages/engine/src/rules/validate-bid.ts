import { EngineError } from '../errors.js';
import type { BidAudit } from '../events.js';
import type { RejectReason } from '../reasons.js';
import { LIMITS } from '../types.js';
import type { BidSource } from '../types.js';
import type { AuctionState, LotState } from '../state.js';
import { available, bidderFor } from './exposure.js';
import { checkBasicBid, minNextBid } from './pricing-basic.js';
import type { PricingLot } from './pricing-basic.js';
import { checkProxyBid } from './pricing-proxy.js';
import { rank } from './ranking.js';

/** Largest bid amount accepted, in cents (R-ENG-001). */
export const MAX_AMOUNT_CENTS = 100_000_000;

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** The fields of PlaceBid that validation reads. */
export interface BidInput {
  commandId: string;
  auctionId: string;
  lotId: string;
  bidderId: string;
  amountCents: number;
  at: number;
  source: BidSource;
  audit: BidAudit;
}

export type BidCheck =
  | { ok: true }
  | {
      ok: false;
      reason: RejectReason;
      detail: Record<string, string | number | boolean | null>;
    };

/** R-ENG-005: identifiers must be ULIDs; checked before any state is read. */
export function assertBidIds(cmd: BidInput): void {
  for (const [name, v] of [
    ['commandId', cmd.commandId],
    ['auctionId', cmd.auctionId],
    ['lotId', cmd.lotId],
    ['bidderId', cmd.bidderId],
  ] as const) {
    if (typeof v !== 'string' || !ULID_RE.test(v)) throw new EngineError('bad_id', name);
  }
}

/** R-ENG-001: a safe integer from 1 to MAX_AMOUNT_CENTS. */
export function isValidAmount(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 1 && x <= MAX_AMOUNT_CENTS;
}

const fail = (
  reason: RejectReason,
  detail: Record<string, string | number | boolean | null> = {},
): BidCheck => ({ ok: false, reason, detail });

/**
 * Runs the PlaceBid checks in the normative order and reports the first
 * failure (R-ENG-027). Throws `bad_id` before reading state (R-ENG-005).
 */
export function validateBid(state: AuctionState, lot: LotState, cmd: BidInput): BidCheck {
  assertBidIds(cmd);
  const cfg = lot.config;
  if (cfg === null || lot.status !== 'OPEN' || lot.endsAt === null || cmd.at >= lot.endsAt) {
    return fail('lot_not_open', { status: lot.status });
  }
  const bidder = bidderFor(state, cmd.bidderId, cmd.lotId);
  if (bidder === undefined) return fail('unregistered');
  if (bidder.revoked) return fail('ceiling_revoked');
  if (!isValidAmount(cmd.amountCents)) return fail('bad_amount');
  const amount = cmd.amountCents;
  // A voice bid with no confidence score is treated as zero confidence: the gate fails closed.
  // Only the server may set `audit.confirmed`; callers must not forward it from a client.
  const conf = cmd.source === 'voice' ? (cmd.audit.confidenceBps ?? 0) : undefined;
  if (conf !== undefined && conf < state.config.confirmBelowBps && cmd.audit.confirmed !== true) {
    return fail('unconfirmed', {
      confidenceBps: conf,
      confirmBelowBps: state.config.confirmBelowBps,
    });
  }
  const avail = available(state, cmd.bidderId, cmd.lotId);
  if (amount > avail) return fail('over_ceiling', { availableCeilingCents: avail });
  if (amount < cfg.reserveCents) return fail('below_reserve', { reserveCents: cfg.reserveCents });

  const pl: PricingLot = {
    mode: cfg.mode,
    reserveCents: cfg.reserveCents,
    increment: cfg.increment,
  };
  const ranked = rank(lot.bids);
  let reason: RejectReason | null = null;
  if (cfg.mode === 'english') {
    const top = ranked[0];
    if (top !== undefined) {
      const min = minNextBid(pl, ranked);
      if (amount < min) return fail('below_increment', { minNextBidCents: min });
      if (top.bidderId === cmd.bidderId) reason = 'already_leading';
    }
  } else if (cfg.mode === 'proxy') {
    reason = checkProxyBid(pl, ranked, cmd.bidderId, amount);
  } else {
    reason = checkBasicBid(pl, ranked, cmd.bidderId, amount);
  }
  if (reason !== null) return fail(reason);
  if (lot.bids.length >= LIMITS.bidsPerLot)
    return fail('limit_exceeded', { max: LIMITS.bidsPerLot });
  return { ok: true };
}
