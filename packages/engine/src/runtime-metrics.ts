import type { Command } from './commands.js';
import type { Outcome } from './decide/index.js';
import type { LedgerEntry } from './events.js';

/** One decision as seen by the metrics hook (R-ENG-105). */
export interface DecisionMetric {
  commandType: Command['type'];
  outcome: Outcome['kind'];
  /** Rejection reason when the outcome (or the original of a duplicate) is a rejection. */
  reason?: string;
  durationMs: number;
  /** Entries the command appended; empty for noops and duplicates. */
  entries: readonly LedgerEntry[];
}

export type DecisionHook = (m: DecisionMetric) => void;

/** Builds the metric of one finished command. */
export function decisionMetric(
  cmd: Command,
  outcome: Outcome,
  entries: readonly LedgerEntry[],
  durationMs: number,
): DecisionMetric {
  const reason =
    outcome.kind === 'rejected'
      ? outcome.reason
      : outcome.kind === 'duplicate' && outcome.original.kind === 'rejected'
        ? outcome.original.reason
        : undefined;
  const m: DecisionMetric = { commandType: cmd.type, outcome: outcome.kind, durationMs, entries };
  if (reason !== undefined) m.reason = reason;
  return m;
}

/** Calls the hook and swallows every failure, sync or async, so dispatch is never affected. */
export function safeDecision(hook: DecisionHook | undefined, metric: DecisionMetric): void {
  if (hook === undefined) return;
  try {
    const r: unknown = hook(metric);
    if (r instanceof Promise) r.catch(() => undefined);
  } catch {
    // A failing hook must not change the result of the command.
  }
}
