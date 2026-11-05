/** R-QA-048: this many consecutive probe failures raise an alert. */
export const ALERT_AFTER_FAILURES = 2;

export interface ProbeState {
  consecutiveFailures: number;
  alert: boolean;
}

export const INITIAL_PROBE_STATE: ProbeState = { consecutiveFailures: 0, alert: false };

/** Folds one probe round into the running state. A success clears the alert. */
export function nextProbeState(prev: ProbeState, ok: boolean): ProbeState {
  if (ok) return { consecutiveFailures: 0, alert: false };
  const consecutiveFailures = prev.consecutiveFailures + 1;
  return { consecutiveFailures, alert: consecutiveFailures >= ALERT_AFTER_FAILURES };
}

/** A round passes only when every probed route answered with a 2xx status. */
export function roundOk(statuses: readonly number[]): boolean {
  return statuses.length > 0 && statuses.every((s) => s >= 200 && s < 300);
}

/** Fraction of passing rounds, for the 99 percent target in R-QA-048. */
export function availability(rounds: readonly boolean[]): number {
  if (rounds.length === 0) return 1;
  return rounds.filter(Boolean).length / rounds.length;
}
