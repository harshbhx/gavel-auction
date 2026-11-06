import type { BidContext, Cents, ConfirmPrompt, ParseResult, VoiceReason } from '../types.js';
import { validate } from './validate.js';

/** Who gave the answer to a confirm prompt (R-VOX-069). */
export type AnsweredBy = 'bidder' | 'auctioneer' | 'voice';

export type AnswerOutcome =
  | {
      kind: 'bid';
      bidderId: string;
      amountCents: Cents;
      confirmed: true;
      by: AnsweredBy;
    }
  | { kind: 'rejected'; by: AnsweredBy }
  | { kind: 'dropped'; reason: VoiceReason; message: string };

export interface AnswerInput {
  prompt: ConfirmPrompt;
  /** Fresh bid context at answer time: the price may have moved since the prompt. */
  ctx: BidContext;
  /** The chosen option, or null for a decline. */
  optionId: string | null;
  by: AnsweredBy;
  /**
   * The bidder who gave the answer. A bidder (or voice) answer only places that bidder's own
   * option; only the auctioneer may pick another bidder's option.
   */
  answeringBidderId?: string | null;
  /** What the answerer saw: when given it must match the stored option exactly. */
  echo?: { bidderId: string; amountCents: Cents };
}

const DROP_MESSAGES: Partial<Record<VoiceReason, string>> = {
  below_minimum: 'The price moved, so that bid is now too low.',
  above_ceiling: 'That bid is above the bidder limit.',
  not_open: 'Bidding is not open for that bidder.',
  already_high_bidder: 'That bidder already has the high bid.',
  duplicate: 'That bid was already placed.',
};

function messageFor(reason: VoiceReason): string {
  return DROP_MESSAGES[reason] ?? 'That bid can no longer be placed.';
}

/**
 * Answers a confirm prompt. A chosen option is re-validated against the current context before a
 * bid is emitted (R-VOX-069); a decline, an unknown option or an expired prompt places nothing.
 */
export function answerConfirm(input: AnswerInput): AnswerOutcome {
  const { prompt, ctx, optionId, by } = input;
  if (optionId === null) return { kind: 'rejected', by };
  if (ctx.nowMs >= prompt.expiresAtMs) {
    return { kind: 'dropped', reason: 'low_confidence', message: 'That question expired.' };
  }
  const option = prompt.options.find((o) => o.id === optionId);
  if (option === undefined) return { kind: 'rejected', by };
  // A prompt that forbids spoken answers cannot be confirmed by voice (R8-V10).
  if (by === 'voice' && !prompt.spokenAnswerAllowed) return { kind: 'rejected', by };
  // Nobody but the auctioneer confirms a bid for somebody else (R-VOX-069).
  if (by !== 'auctioneer') {
    const who = input.answeringBidderId;
    if (who === undefined || who === null || option.bidderId !== who) {
      return { kind: 'rejected', by };
    }
  }
  const echo = input.echo;
  if (
    echo !== undefined &&
    (echo.bidderId !== option.bidderId || echo.amountCents !== option.amountCents)
  ) {
    return { kind: 'rejected', by };
  }

  const parse: ParseResult = {
    status: 'bid',
    bidder: { kind: 'speaker', value: option.bidderId },
    amountCents: option.amountCents,
    reason: 'ok',
    candidates: [],
    flags: [],
    confidence: 1,
    source: 'rules',
  };
  const verdict = validate(parse, ctx);
  if (verdict.kind === 'accept') {
    return {
      kind: 'bid',
      bidderId: verdict.bidderId,
      amountCents: verdict.amountCents,
      confirmed: true,
      by,
    };
  }
  // The answer is the confirmation a large jump asks for.
  if (verdict.kind === 'confirm' && verdict.reason === 'large_jump' && verdict.bidderId !== null) {
    return {
      kind: 'bid',
      bidderId: verdict.bidderId,
      amountCents: option.amountCents,
      confirmed: true,
      by,
    };
  }
  const reason = verdict.reason;
  return { kind: 'dropped', reason, message: messageFor(reason) };
}

const YES = new Set(['yes', 'yeah', 'yep', 'correct', "that's right", 'thats right', 'confirm']);
const NO = new Set(['no', 'nope', 'cancel', 'wrong']);

export type SpokenAnswer = 'yes' | 'no' | 'ignore';

export interface SpokenContext {
  /** Device-attributed microphone (one bidder) versus a shared room microphone. */
  mic: 'device' | 'room';
  speakerBidderId: string | null;
  /** Prompts open at the same time. */
  openPrompts: number;
}

/** Normalizes a spoken reply: lower case, no punctuation, single spaces. */
function normalizeReply(text: string): string {
  return text
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim();
}

/**
 * Reads a spoken yes or no for a prompt (R-VOX-070). Only a device microphone whose speaker is
 * the prompt bidder, with exactly one open prompt, may answer; everything else is ignored.
 */
export function parseSpokenAnswer(
  text: string,
  prompt: ConfirmPrompt,
  spoken: SpokenContext,
): SpokenAnswer {
  if (!prompt.spokenAnswerAllowed) return 'ignore';
  if (spoken.mic !== 'device' || spoken.openPrompts !== 1) return 'ignore';
  if (spoken.speakerBidderId === null) return 'ignore';
  const first = prompt.options[0];
  if (first === undefined) return 'ignore';
  if (!prompt.options.every((o) => o.bidderId === spoken.speakerBidderId)) return 'ignore';
  const reply = normalizeReply(text);
  if (NO.has(reply)) return 'no';
  // A yes picks the option only when there is exactly one to pick.
  if (YES.has(reply) && prompt.options.length === 1) return 'yes';
  return 'ignore';
}
