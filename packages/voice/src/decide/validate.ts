import type { BidContext, Cents, ParseResult, VoiceReason } from '../types.js';

export const DUPLICATE_WINDOW_MS = 3000;
export const JUMP_FACTOR = 5;
export const JUMP_ABSOLUTE_CENTS = 100000;

export type Verdict =
  | { kind: 'accept'; bidderId: string; amountCents: Cents }
  | {
      kind: 'confirm';
      reason: VoiceReason;
      bidderId: string | null;
      amountCents: Cents | null;
      /** Amounts that survived validation when the parse itself had several (R-VOX-065). */
      candidates?: readonly Cents[];
      /** Per-bidder readings when the parse named several bidders (crosstalk, speaker vs paddle). */
      choices?: readonly { bidderId: string; amountCents: Cents }[];
    }
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

/** Why a single amount can never be placed by this bidder right now, or null when it can. */
function rejection(amount: Cents, who: Resolved, ctx: BidContext): VoiceReason | null {
  if (amount <= ctx.currentPriceCents) return 'below_minimum';
  if (amount < ctx.currentPriceCents + ctx.minIncrementCents) return 'below_minimum';
  if (amount > who.ceilingCents) return 'above_ceiling';
  if (ctx.highBidderId === who.bidderId) return 'already_high_bidder';
  const duplicate = ctx.recent.some(
    (r) =>
      r.bidderId === who.bidderId &&
      r.amountCents === amount &&
      ctx.nowMs - r.atMs >= 0 &&
      ctx.nowMs - r.atMs <= DUPLICATE_WINDOW_MS,
  );
  return duplicate ? 'duplicate' : null;
}

/**
 * A confirm parse with candidates and no single amount (multiple amounts, "to"/"for"
 * ambiguity): keep the candidates that pass, ask the bidder to choose, and drop only when
 * none survive (R-VOX-065, T-VOX-073).
 */
function validateCandidates(parse: ParseResult, ctx: BidContext, who: Resolved): Verdict {
  if (parse.status !== 'confirm') return { kind: 'drop', reason: 'no_amount' };
  const amounts: Cents[] = [];
  let lastReason: VoiceReason = 'no_amount';
  for (const c of parse.candidates) {
    if (c.amountCents === null) continue;
    const why = rejection(c.amountCents, who, ctx);
    if (why === null) {
      if (!amounts.includes(c.amountCents)) amounts.push(c.amountCents);
    } else {
      lastReason = why;
    }
  }
  if (amounts.length === 0) return { kind: 'drop', reason: lastReason };
  return {
    kind: 'confirm',
    reason: parse.reason,
    bidderId: who.bidderId,
    amountCents: amounts.length === 1 ? (amounts[0] ?? null) : null,
    candidates: amounts,
  };
}

function distinctAmounts(parse: ParseResult): number {
  const seen = new Set<Cents>();
  for (const c of parse.candidates) if (c.amountCents !== null) seen.add(c.amountCents);
  return seen.size;
}

function hasSeveralBidders(parse: ParseResult): boolean {
  if (parse.status !== 'confirm' || parse.amountCents !== null) return false;
  const keys = new Set<string>();
  for (const c of parse.candidates) {
    if (c.bidder !== null && c.amountCents !== null) keys.add(`${c.bidder.kind}:${c.bidder.value}`);
  }
  return keys.size > 1;
}

/**
 * Candidates that name different bidders: each reading is checked against its own bidder, and
 * every one that can be placed is offered, so no reading is lost (R12-V03).
 */
function validateBidders(parse: ParseResult, ctx: BidContext): Verdict {
  if (ctx.lotState !== 'OPEN' && ctx.lotState !== 'CLOSING') {
    return { kind: 'drop', reason: 'not_open' };
  }
  const choices: { bidderId: string; amountCents: Cents }[] = [];
  let lastReason: VoiceReason = 'unknown_bidder';
  for (const c of parse.candidates) {
    if (c.bidder === null || c.amountCents === null) continue;
    const who = resolve({ ...parse, bidder: c.bidder }, ctx);
    if (who === null) {
      lastReason = c.bidder.kind === 'paddle' ? 'unregistered_paddle' : 'unknown_bidder';
      continue;
    }
    if (!who.holdActive) {
      lastReason = 'not_open';
      continue;
    }
    const why = rejection(c.amountCents, who, ctx);
    if (why !== null) {
      lastReason = why;
      continue;
    }
    if (!choices.some((o) => o.bidderId === who.bidderId && o.amountCents === c.amountCents)) {
      choices.push({ bidderId: who.bidderId, amountCents: c.amountCents });
    }
  }
  const first = choices[0];
  if (first === undefined) return { kind: 'drop', reason: lastReason };
  return {
    kind: 'confirm',
    reason: parse.reason,
    bidderId: first.bidderId,
    amountCents: null,
    candidates: [...new Set(choices.map((o) => o.amountCents))],
    choices,
  };
}

/**
 * Last-stage checks (R-VOX-064). Can only downgrade or reject: a parse that is not a clean
 * bid never becomes an accept.
 */
export function validate(parse: ParseResult, ctx: BidContext): Verdict {
  if (parse.status === 'none') return { kind: 'drop', reason: parse.reason };

  if (hasSeveralBidders(parse)) return validateBidders(parse, ctx);

  const who = resolve(parse, ctx);
  if (who === null) {
    // A currency utterance keeps its own reason: relabelling it hides why no amount is offered.
    if (parse.reason === 'unsupported_currency') return confirm(parse, parse.reason, null);
    const reason = parse.bidder?.kind === 'paddle' ? 'unregistered_paddle' : 'unknown_bidder';
    return confirm(parse, reason, null);
  }
  if (!who.holdActive) return { kind: 'drop', reason: 'not_open' };
  if (ctx.lotState !== 'OPEN' && ctx.lotState !== 'CLOSING') {
    return { kind: 'drop', reason: 'not_open' };
  }

  const amount = parse.amountCents;
  if (amount === null && parse.reason === 'unsupported_currency') {
    return confirm(parse, 'unsupported_currency', who.bidderId);
  }
  if (amount === null) return validateCandidates(parse, ctx, who);
  // Several distinct readings (e.g. 'fifteen' as 1500 or 5000): the minimum applies per
  // candidate, so a reading that cannot be placed never hides one that can.
  if (parse.status === 'confirm' && distinctAmounts(parse) > 1) {
    return validateCandidates(parse, ctx, who);
  }

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
