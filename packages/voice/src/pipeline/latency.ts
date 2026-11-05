/** Latency budget, speech end to decision (R-VOX-101). */
export const BUDGET_COMPONENTS_MS = {
  endpointing: 300,
  network: 100,
  sttFinal: 150,
  parse: 5,
  model: 600,
  validate: 5,
  slack: 40,
} as const;

export const BUDGET_TOTAL_MS: number = Object.values(BUDGET_COMPONENTS_MS).reduce(
  (a, b) => a + b,
  0,
);

export type BudgetMode = 'model' | 'rules_only';

export const BUDGET_LIMITS_MS: Record<BudgetMode, { p50: number; p95: number }> = {
  model: { p50: 1200, p95: 2000 },
  rules_only: { p50: 700, p95: 2000 },
};

export interface LatencySample {
  speechEndMs: number;
  decisionMs: number;
}

export interface BudgetReport {
  count: number;
  p50: number;
  p95: number;
  pass: boolean;
  p50Pass: boolean;
  p95Pass: boolean;
}

/** Milliseconds from speech end to decision for one segment, never negative. */
export function latencyOf(sample: LatencySample): number {
  return Math.max(0, sample.decisionMs - sample.speechEndMs);
}

/** Nearest-rank percentile (p in 0..100) of values; 0 for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? 0;
}

/** Evaluates samples against the 1200 / 2000 ms budget (700 ms p50 when rules only). */
export function budgetCheck(
  samples: readonly LatencySample[],
  mode: BudgetMode = 'model',
): BudgetReport {
  const values = samples.map(latencyOf);
  const p50 = percentile(values, 50);
  const p95 = percentile(values, 95);
  const limit = BUDGET_LIMITS_MS[mode];
  const p50Pass = values.length > 0 && p50 <= limit.p50;
  const p95Pass = values.length > 0 && p95 <= limit.p95;
  return { count: values.length, p50, p95, pass: p50Pass && p95Pass, p50Pass, p95Pass };
}
