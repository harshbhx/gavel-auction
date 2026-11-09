import type { CopyKey } from './en';

/**
 * Wording banned in every catalog string shown before a CAPTURED state (SPEC-web 11.3, R-WEB-120).
 * A negation ("not charged", "not a payment") or "charged only if" is allowed.
 */
export const bannedBeforeCapture: RegExp[] = [
  /(?<!not )\bcharg(?:e|es|ed|ing)\b(?! only if)/i,
  /\bpay(?:s|ing)?\b/i,
  /\bpaid\b/i,
  /(?<!not a )\bpayments?\b/i,
  // Money is only captured once the state is CAPTURED, so "capture" cannot describe an earlier step.
  /\bcaptur(?:e|es|ed|ing)\b/i,
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
 * Keys that contain a banned word but are safe: they are shown only once money is charged
 * (a CAPTURED lane, a settlement narrative or a failed capture), or use "first" as an ordinal.
 * Every entry needs a reason, and the set is pinned by a test, so adding one is a visible change.
 * Text that explains the rule before capture is not exempt: it must pass the ban, for example
 * with "charged only if".
 */
export const wordingExemptions: Readonly<Partial<Record<CopyKey, string>>> = {
  'banner.fakePayments': 'provenance label that says payments are fake, no claim of a charge',
  'ladder.state.CAPTURED': 'ladder state label shown only for a CAPTURED lane',
  'ladder.invariants.ok': 'settlement totals line shown only after capture',
  'ladder.fallback': 'settlement narrative shown after a failed capture attempt',
  'screen.settleSummary': 'settlement counts line, shown only once the phase is final',
  'mk.trust.lat.body':
    'gate-record latency wording: names the CAPTURED state measured on the sandbox, no claim that money moved here',
  'bid.waitingLot': 'ordinal use of "first", not a claim',
  'replay.chapter.bid': 'chapter label, ordinal use of "first"',
};
