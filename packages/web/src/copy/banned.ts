import type { CopyKey } from './en';

/**
 * Wording banned in every catalog string shown before a CAPTURED state (SPEC-web 11.3, R-WEB-120).
 * A negation ("not charged", "not a payment") or "charged only if" is allowed.
 */
export const bannedBeforeCapture: RegExp[] = [
  /(?<!not )\bcharged\b(?! only if)/i,
  /\bpay\b/i,
  /(?<!not a )\bpayments?\b/i,
  /\bdebit(?:ed)?\b/i,
  /\bbilled\b/i,
  /\bdeducted\b/i,
  /\bfees?\b/i,
];

/** Claims about what PayPal or a bank does with funds, which the app must never make. */
export const bannedEverywhere: RegExp[] = [
  /your bank will show/i,
  /balance reduced/i,
  /\bbest\b/i,
  /\brevolutionary\b/i,
];

/** Marketing superlative checked everywhere; individual keys that use it neutrally are exempt below. */
export const superlativeFirst: RegExp = /\bfirst\b/i;

/**
 * Keys that contain a banned word but are safe: they are shown only once money is charged,
 * or they describe the rule itself in plain words, or use "first" as an ordinal.
 * Every entry needs a reason.
 */
export const wordingExemptions: Readonly<Partial<Record<CopyKey, string>>> = {
  'landing.explain': 'states the rule: only the winner is charged, after the hammer',
  'ladder.state.CAPTURED': 'ladder state label shown only for a CAPTURED lane',
  'ladder.invariants.ok': 'settlement totals line shown only after capture',
  'ladder.fallback': 'settlement narrative shown after a failed capture attempt',
  'receipt.capturing': 'receipt copy for the capture step itself',
  'receipt.failed': 'receipt copy for a failed capture',
  'bid.waitingLot': 'ordinal use of "first", not a claim',
  'replay.chapter.bid': 'chapter label, ordinal use of "first"',
};
