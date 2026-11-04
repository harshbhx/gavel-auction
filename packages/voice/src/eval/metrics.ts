import { findNumberSpans, tokenize } from '../parser/normalize.js';
import { spanValue } from '../parser/numbers.js';

/**
 * Metric definitions of the G5 evaluation (R-VOX-074, spec section 10). Pure functions over a list
 * of per-utterance results; no clock and no I/O.
 */

/** A bidder pair: paddle or bidder id, and the amount in cents. */
export interface Pair {
  who: string;
  amountCents: number;
}

export type Expected =
  | { outcome: 'bid'; pair: Pair }
  | { outcome: 'confirm'; intended?: Pair; acceptableConfirm: Pair[][] }
  | { outcome: 'none' };

export type Actual =
  | { kind: 'accept'; pair: Pair }
  | { kind: 'confirm'; candidates: Pair[] }
  | { kind: 'none' };

export interface EvalResult {
  id: string;
  expected: Expected;
  actual: Actual;
  /** Decision latency in milliseconds. */
  latencyMs: number;
  provider: string;
  /** Reference transcript and recognised text, for the number-token error rate. */
  referenceText?: string;
  recognizedText?: string;
}

export interface Metrics {
  n: number;
  bidN: number;
  noneN: number;
  exactRate: number;
  wrongAcceptRate: number;
  confirmRate: number;
  recoverableRate: number;
  missedBidRate: number;
  falsePromptRate: number;
  /** Keyed by provider; providers with no utterance containing a number are absent. */
  numberTokenErrorRate: Record<string, number>;
  latencyP50Ms: number;
  latencyP95Ms: number;
}

const samePair = (a: Pair, b: Pair): boolean => a.who === b.who && a.amountCents === b.amountCents;

export function isExact(r: EvalResult): boolean {
  return (
    r.expected.outcome === 'bid' &&
    r.actual.kind === 'accept' &&
    samePair(r.expected.pair, r.actual.pair)
  );
}

export function isWrongAccept(r: EvalResult): boolean {
  return r.actual.kind === 'accept' && !isExact(r);
}

export function isRecoverable(r: EvalResult): boolean {
  const { expected, actual } = r;
  return (
    expected.outcome === 'bid' &&
    actual.kind === 'confirm' &&
    actual.candidates.some((c) => samePair(c, expected.pair))
  );
}

export function isMissedBid(r: EvalResult): boolean {
  return r.expected.outcome === 'bid' && r.actual.kind === 'none';
}

export function isFalsePrompt(r: EvalResult): boolean {
  return r.expected.outcome === 'none' && r.actual.kind === 'confirm';
}

/** Nearest-rank percentile of an unsorted list; 0 for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? 0;
}

function ratio(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

/** Number tokens of a text after normalization: each number span becomes its value in cents. */
export function numberTokens(text: string): string[] {
  const words = tokenize(text).map((t) => t.text);
  return findNumberSpans(words).map(([start, end]) => {
    const span = words.slice(start, end);
    const value = spanValue(span);
    return value === null ? span.join(' ') : String(value);
  });
}

export function editDistance(a: readonly string[], b: readonly string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_v, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const sub = (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      row.push(Math.min(sub, (prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1));
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

function numberTokenErrorRates(results: readonly EvalResult[]): Record<string, number> {
  const errors = new Map<string, { dist: number; ref: number }>();
  for (const r of results) {
    if (r.referenceText === undefined || r.recognizedText === undefined) continue;
    const ref = numberTokens(r.referenceText);
    if (ref.length === 0) continue;
    const acc = errors.get(r.provider) ?? { dist: 0, ref: 0 };
    acc.dist += editDistance(ref, numberTokens(r.recognizedText));
    acc.ref += ref.length;
    errors.set(r.provider, acc);
  }
  const out: Record<string, number> = {};
  for (const [provider, { dist, ref }] of errors) out[provider] = dist / ref;
  return out;
}

export function evaluate(results: readonly EvalResult[]): Metrics {
  const n = results.length;
  const bidN = results.filter((r) => r.expected.outcome === 'bid').length;
  const noneN = results.filter((r) => r.expected.outcome === 'none').length;
  const latencies = results.map((r) => r.latencyMs);
  return {
    n,
    bidN,
    noneN,
    exactRate: ratio(results.filter(isExact).length, bidN),
    wrongAcceptRate: ratio(results.filter(isWrongAccept).length, n),
    confirmRate: ratio(results.filter((r) => r.actual.kind === 'confirm').length, n),
    recoverableRate: ratio(results.filter(isRecoverable).length, bidN),
    missedBidRate: ratio(results.filter(isMissedBid).length, bidN),
    falsePromptRate: ratio(results.filter(isFalsePrompt).length, noneN),
    numberTokenErrorRate: numberTokenErrorRates(results),
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
  };
}
