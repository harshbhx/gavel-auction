import type { BidContext, Cents, ParseResult, VoiceReason } from '../types.js';

export const DUPLICATE_WINDOW_MS = 3000;
export const JUMP_FACTOR = 5;
export const JUMP_ABSOLUTE_CENTS = 100000;

export type Verdict =
  | { kind: 'accept'; bidderId: string; amountCents: Cents }
  | { kind: 'confirm'; reason: VoiceReason; bidderId: string | null; amountCents: Cents | null }
  | { kind: 'drop'; reason: VoiceReason };

type Resolved = { bidderId: string; ceilingCents: Cents; holdActive: boolean };

function resolve(parse: ParseResult, ctx: BidContext): Resolved | null {
  const ref = parse.bidder;
  if (ref === null) return null;
  if (ref.kind === 'paddle') return ctx.roster.get(ref.value) ?? null;
  for (const entry of ctx.roster.values()) {
    if (entry.bidderId === ref.value) return entry;
  }
  return null;
}

function confirm(parse: ParseResult, reason: VoiceReason, bidderId: string | null): Verdict {
  return { kind: 'confirm', reason, bidderId, amountCents: parse.amountCents };
}

function hasHomophoneAlternative(parse: ParseResult, price: Cents): boolean {
  return parse.candidates.some((c) => c.amountCents !== null && c.amountCents > price);
}

/**
 * Last-stage checks (R-VOX-064). Can only downgrade or reject: a parse that is not a clean
 * bid never becomes an accept.
 */
export function validate(parse: ParseResult, ctx: BidContext): Verdict {
  if (parse.status === 'none') return { kind: 'drop', reason: parse.reason };

  const who = resolve(parse, ctx);
  if (who === null) {
    const reason = parse.bidder?.kind === 'paddle' ? 'unregistered_paddle' : 'unknown_bidder';
    return confirm(parse, reason, null);
  }
  if (!who.holdActive) return { kind: 'drop', reason: 'not_open' };
  if (ctx.lotState !== 'OPEN' && ctx.lotState !== 'CLOSING') {
    return { kind: 'drop', reason: 'not_open' };
  }

  const amount = parse.amountCents;
  if (amount === null) return { kind: 'drop', reason: 'no_amount' };

  const price = ctx.currentPriceCents;
  if (amount <= price) {
    if (hasHomophoneAlternative(parse, price)) return confirm(parse, 'homophone', who.bidderId);
    return { kind: 'drop', reason: 'below_minimum' };
  }
  if (amount < price + ctx.minIncrementCents) return { kind: 'drop', reason: 'below_minimum' };
  if (amount > who.ceilingCents) return { kind: 'drop', reason: 'above_ceiling' };
  if (ctx.highBidderId === who.bidderId) return { kind: 'drop', reason: 'already_high_bidder' };

  const duplicate = ctx.recent.some(
    (r) =>
      r.bidderId === who.bidderId &&
      r.amountCents === amount &&
      ctx.nowMs - r.atMs >= 0 &&
      ctx.nowMs - r.atMs <= DUPLICATE_WINDOW_MS,
  );
  if (duplicate) return { kind: 'drop', reason: 'duplicate' };

  const jump = price > 0 && amount >= JUMP_FACTOR * price;
  if (jump || amount - price >= JUMP_ABSOLUTE_CENTS) {
    return confirm(parse, 'large_jump', who.bidderId);
  }

  if (parse.status === 'bid') {
    return { kind: 'accept', bidderId: who.bidderId, amountCents: amount };
  }
  return confirm(parse, parse.reason, who.bidderId);
}
