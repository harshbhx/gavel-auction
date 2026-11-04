import type { VoiceReason } from '../types.js';
import { findNumberSpans, tokenize } from './normalize.js';

/**
 * Intent classes that are not plain bids (R-VOX-045, 046, 047): withdrawals, negations, hedges,
 * questions and auctioneer or background talk. Pure and total.
 */

export type IntentKind =
  | 'bid_like'
  | 'withdraw'
  | 'negation'
  | 'hedged'
  | 'question'
  | 'background';

export interface Intent {
  kind: IntentKind;
  /** Parser status this intent forces, or null when the text is still a bid candidate. */
  status: 'none' | 'confirm' | null;
  reason: VoiceReason | null;
}

const WITHDRAW = /(^| )(i'm out|i am out|i pass|pass|no thanks)( |$)/;
const HEDGE =
  /(^| )(maybe|perhaps|thinking|about|around|roughly|between|or so|not sure|might|i guess)( |$)/;
const BACKGROUND =
  /(^| )(the price is|price is|it's at|now at|currently|reserve|starting|opening|we are at|we're at|going once|going twice|going three times|fair warning|sold|kids|years old|people)( |$)/;
const QUESTION_START = new Set([
  'is',
  'did',
  'was',
  'what',
  'how',
  'who',
  'can',
  'could',
  'does',
  'do',
  'are',
  'why',
]);
const NEGATIONS = new Set([
  'not',
  "don't",
  'dont',
  "doesn't",
  "won't",
  'wont',
  'never',
  "can't",
  'cant',
  'cannot',
  "isn't",
  "wouldn't",
]);
/** How many tokens before an amount a negation still applies. */
const NEGATION_SCOPE = 3;

const intent = (
  kind: IntentKind,
  status: Intent['status'],
  reason: VoiceReason | null,
): Intent => ({ kind, status, reason });

/** Negated and affirmative amount counts, clause by clause (clauses end at , ; . ! ?). */
function negationCounts(text: string): { negated: number; affirmative: number } {
  let negated = 0;
  let affirmative = 0;
  for (const clause of text.split(/[,;.!?]+/)) {
    const tokens = tokenize(clause).map((t) => t.text);
    for (const [s] of findNumberSpans(tokens)) {
      let neg = false;
      for (let k = Math.max(0, s - NEGATION_SCOPE); k < s; k++) {
        const w = tokens[k] ?? '';
        if (NEGATIONS.has(w) || (w === 'thanks' && tokens[k - 1] === 'no')) neg = true;
      }
      if (neg) negated += 1;
      else affirmative += 1;
    }
  }
  return { negated, affirmative };
}

export function detectIntent(text: string): Intent {
  const tokens = tokenize(text).map((t) => t.text);
  const norm = tokens.join(' ');
  if (WITHDRAW.test(norm)) return intent('withdraw', 'none', 'withdraw');
  if (HEDGE.test(norm)) return intent('hedged', 'confirm', 'hedged');
  const first = tokens[0] ?? '';
  const doNot = first === 'do' && tokens[1] === 'not';
  if (text.includes('?') || (QUESTION_START.has(first) && !doNot)) {
    return intent('question', 'none', 'question');
  }
  if (BACKGROUND.test(norm)) return intent('background', 'none', 'auctioneer_talk');
  const { negated, affirmative } = negationCounts(text);
  if (negated > 0) {
    return affirmative > 0
      ? intent('negation', 'confirm', 'negation')
      : intent('negation', 'none', 'negation');
  }
  return intent('bid_like', null, null);
}
