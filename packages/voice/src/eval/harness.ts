import { evaluate, type EvalResult, type Metrics } from './metrics.js';

/** G5 thresholds of R-VOX-076. */
export const G5_MIN_USABLE_RATE = 0.9;
export const G5_MAX_WRONG_ACCEPT_RATE = 0.05;

export const ASSIST_MODE_NOTICE =
  'G5 failed: the product switches to assist mode, every voice bid requires confirm.';

export interface GateResult {
  pass: boolean;
  /** (exact + recoverable) over bid-labelled utterances. */
  usableRate: number;
  wrongAcceptRate: number;
  /** Failed conditions, in plain words; empty on a pass. */
  reasons: string[];
  /** Set on a failure: the report must say the product runs in assist mode. */
  notice: string | null;
}

/**
 * Pass when (exact + recoverable) over bid-labelled utterances is at least 0.90 and the wrong
 * accept rate is at most 0.05. The comparisons are exact on the rates, so a value at the limit
 * passes; callers pass the rates computed by evaluate() on the audio set with the default config.
 */
export function gateG5(metrics: Metrics): GateResult {
  const usableRate = metrics.exactRate + metrics.recoverableRate;
  const reasons: string[] = [];
  // Rates come from integer ratios; compare in millionths to keep 0.9 and 0.05 exact.
  if (Math.round(usableRate * 1e6) < G5_MIN_USABLE_RATE * 1e6) {
    reasons.push(`exact + recoverable ${usableRate.toFixed(3)} is below ${G5_MIN_USABLE_RATE}`);
  }
  if (Math.round(metrics.wrongAcceptRate * 1e6) > G5_MAX_WRONG_ACCEPT_RATE * 1e6) {
    reasons.push(
      `wrong accept ${metrics.wrongAcceptRate.toFixed(3)} is above ${G5_MAX_WRONG_ACCEPT_RATE}`,
    );
  }
  const pass = reasons.length === 0;
  return {
    pass,
    usableRate,
    wrongAcceptRate: metrics.wrongAcceptRate,
    reasons,
    notice: pass ? null : ASSIST_MODE_NOTICE,
  };
}

/** Plain-text report: the metrics, the gate verdict and, on a failure, the assist-mode notice. */
export function runHarness(results: readonly EvalResult[]): {
  metrics: Metrics;
  gate: GateResult;
  report: string;
} {
  const metrics = evaluate(results);
  const gate = gateG5(metrics);
  const lines = [
    `utterances ${metrics.n} (bid ${metrics.bidN}, none ${metrics.noneN})`,
    `exactRate ${metrics.exactRate.toFixed(3)}`,
    `wrongAcceptRate ${metrics.wrongAcceptRate.toFixed(3)}`,
    `confirmRate ${metrics.confirmRate.toFixed(3)}`,
    `recoverableRate ${metrics.recoverableRate.toFixed(3)}`,
    `missedBidRate ${metrics.missedBidRate.toFixed(3)}`,
    `falsePromptRate ${metrics.falsePromptRate.toFixed(3)}`,
    ...Object.entries(metrics.numberTokenErrorRate).map(
      ([p, v]) => `numberTokenErrorRate[${p}] ${v.toFixed(3)}`,
    ),
    `decision latency p50 ${metrics.latencyP50Ms} ms, p95 ${metrics.latencyP95Ms} ms`,
    `G5 ${gate.pass ? 'pass' : 'fail'}`,
    ...gate.reasons,
    ...(gate.notice === null ? [] : [gate.notice]),
  ];
  return { metrics, gate, report: lines.join('\n') };
}

export { evaluate };
export type { EvalResult, Metrics };
