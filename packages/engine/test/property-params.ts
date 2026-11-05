import { randomInt } from 'node:crypto';

// R-QA-023: property tests run at least 200 cases and the seed changes between runs, so
// different inputs are explored over time. The seed is printed so a failure can be replayed.
// Pin it with GAVEL_PROPERTY_SEED; CI uses GITHUB_RUN_ID when no seed is given.
export const MIN_RUNS = 200;

function pickSeed(): number {
  const pinned = process.env['GAVEL_PROPERTY_SEED'];
  if (pinned !== undefined && pinned !== '' && Number.isInteger(Number(pinned))) {
    return Number(pinned);
  }
  const ci = Number(process.env['GITHUB_RUN_ID']);
  return Number.isSafeInteger(ci) && ci > 0 ? ci % 2 ** 31 : randomInt(2 ** 31);
}

export const SEED = pickSeed();

/** Run count for one file: GAVEL_PROPERTY_RUNS or the file default, never below MIN_RUNS. */
export function runsFor(file: string, defaultRuns: number): number {
  const fromEnv = Number(process.env['GAVEL_PROPERTY_RUNS']);
  const wanted = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : defaultRuns;
  const runs = Math.max(MIN_RUNS, wanted);
  console.log(`${file}: seed=${SEED} numRuns=${runs} (replay with GAVEL_PROPERTY_SEED=${SEED})`);
  return runs;
}
