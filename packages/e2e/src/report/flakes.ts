// Flake tracking (R-QA-033): retried tests are recorded in report/flakes.json and a test is
// quarantined on its second flake inside a 7 day window. Pure functions; callers do the IO.

export const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const QUARANTINE_TAG = '@quarantine';

export interface FlakeEntry {
  test: string;
  at: string;
}

export interface FlakeLog {
  flakes: FlakeEntry[];
  quarantined: string[];
}

export interface TestOutcome {
  test: string;
  retries: number;
  passed: boolean;
}

export function emptyLog(): FlakeLog {
  return { flakes: [], quarantined: [] };
}

// A flake is a test that passed only after at least one retry.
export function findFlakes(outcomes: readonly TestOutcome[]): string[] {
  return outcomes.filter((o) => o.passed && o.retries > 0).map((o) => o.test);
}

export function recentCount(log: FlakeLog, test: string, now: Date): number {
  const from = now.getTime() - WINDOW_MS;
  return log.flakes.filter((f) => f.test === test && Date.parse(f.at) >= from).length;
}

export interface RecordResult {
  log: FlakeLog;
  newlyQuarantined: string[];
}

export function recordFlakes(log: FlakeLog, tests: readonly string[], now: Date): RecordResult {
  const flakes = [...log.flakes];
  const quarantined = [...log.quarantined];
  const newlyQuarantined: string[] = [];
  for (const test of tests) {
    flakes.push({ test, at: now.toISOString() });
    const next = { flakes, quarantined };
    if (recentCount(next, test, now) >= 2 && !quarantined.includes(test)) {
      quarantined.push(test);
      newlyQuarantined.push(test);
    }
  }
  return { log: { flakes, quarantined }, newlyQuarantined };
}

// Titles carrying the tag are excluded from required checks.
export function isQuarantined(title: string): boolean {
  return title.includes(QUARANTINE_TAG);
}

export function tagTitle(title: string): string {
  return isQuarantined(title) ? title : `${title} ${QUARANTINE_TAG}`;
}
