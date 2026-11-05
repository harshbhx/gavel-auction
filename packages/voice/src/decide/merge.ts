import type { BidderRef, Candidate, ParseResult } from '../types.js';
import { CAP } from './score.js';

export const AUTO_RULES_ONLY = 0.9;
export const LLM_NONE_MIN = 0.8;
export const MAX_CANDIDATES = 3;

function sameBidder(a: BidderRef | null, b: BidderRef | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.value === b.value;
}

function sameCandidate(a: Candidate, b: Candidate): boolean {
  return a.amountCents === b.amountCents && sameBidder(a.bidder, b.bidder);
}

function bidderKey(b: BidderRef | null): string {
  return b === null ? '' : `${b.kind}:${b.value}`;
}

function ownCandidate(p: ParseResult): Candidate[] {
  return p.amountCents === null ? [] : [{ bidder: p.bidder, amountCents: p.amountCents }];
}

function union(...lists: Candidate[][]): Candidate[] {
  const out: Candidate[] = [];
  for (const c of lists.flat()) {
    if (!out.some((o) => sameCandidate(o, c))) out.push(c);
  }
  out.sort((a, b) => {
    const d = (a.amountCents ?? 0) - (b.amountCents ?? 0);
    return d !== 0 ? d : bidderKey(a.bidder).localeCompare(bidderKey(b.bidder));
  });
  return out.slice(0, MAX_CANDIDATES);
}

function confirmFrom(
  rules: ParseResult,
  candidates: Candidate[],
  reason: ParseResult['reason'],
  source: ParseResult['source'],
): ParseResult {
  return {
    status: 'confirm',
    bidder: candidates[0]?.bidder ?? null,
    amountCents: candidates[0]?.amountCents ?? null,
    reason,
    candidates,
    flags: rules.flags,
    confidence: rules.confidence,
    source,
    ...(rules.spans ? { spans: rules.spans } : {}),
  };
}

/**
 * Section 7.3 merge table. The model can only agree with a value the rules parser found, or
 * add confirm candidates; it can never produce an auto-accepted bid by itself (R-VOX-059).
 */
export function merge(rules: ParseResult, llm: ParseResult | null): ParseResult {
  if (rules.status === 'bid') {
    if (llm === null) {
      if (rules.flags.length === 0 && rules.confidence >= AUTO_RULES_ONLY) return rules;
      return confirmFrom(rules, union(ownCandidate(rules)), rules.reason, 'rules');
    }
    if (llm.status === 'bid') {
      const agree = llm.amountCents === rules.amountCents && sameBidder(llm.bidder, rules.bidder);
      if (agree) {
        const clean = rules.flags.length === 0 && llm.flags.length === 0;
        const confidence = clean
          ? Math.round(Math.min(CAP, rules.confidence * 1.02) * 100) / 100
          : rules.confidence;
        return { ...rules, confidence, source: 'merged' };
      }
      return confirmFrom(
        rules,
        union(ownCandidate(rules), ownCandidate(llm)),
        'llm_disagree',
        'merged',
      );
    }
    return confirmFrom(rules, union(ownCandidate(rules)), rules.reason, 'merged');
  }

  if (rules.status === 'confirm') {
    const extra = llm === null ? [] : [...llm.candidates, ...ownCandidate(llm)];
    const own = rules.candidates.length > 0 ? rules.candidates : ownCandidate(rules);
    return confirmFrom(rules, union(own, extra), rules.reason, llm === null ? 'rules' : 'merged');
  }

  if (llm !== null && llm.status === 'bid' && llm.confidence >= LLM_NONE_MIN) {
    return { ...confirmFrom(rules, union(ownCandidate(llm)), 'llm_disagree', 'merged') };
  }
  return rules;
}
