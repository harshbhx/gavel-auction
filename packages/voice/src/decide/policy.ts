import type { ParseResult, VoiceReason } from '../types.js';

export interface PolicyConfig {
  auto: number;
  confirm: number;
}

export const DEFAULT_POLICY: PolicyConfig = { auto: 0.85, confirm: 0.5 };

export type Classification = 'accept' | 'confirm' | 'drop';

/** Reasons that always force a confirm prompt regardless of confidence (R-VOX-065). */
export const HARD_FLAGS: readonly VoiceReason[] = [
  'correction',
  'multiple_amounts',
  'multiple_bidders',
  'hedged',
  'homophone',
  'to_for_ambiguity',
  'unsupported_currency',
  'fractional_amount',
  'large_jump',
  'llm_disagree',
  'unregistered_paddle',
  'implausible_amount',
];

function hasHardFlag(parse: ParseResult): boolean {
  return HARD_FLAGS.includes(parse.reason) || parse.flags.includes('correction');
}

/** Decision kind: accept when confident and clean, confirm when unsure or flagged, else drop. */
export function classify(parse: ParseResult, cfg: PolicyConfig = DEFAULT_POLICY): Classification {
  if (parse.status === 'none') return 'drop';
  if (hasHardFlag(parse)) return 'confirm';
  if (parse.confidence < cfg.confirm) return 'drop';
  if (parse.status === 'confirm' || parse.confidence < cfg.auto) return 'confirm';
  return 'accept';
}
