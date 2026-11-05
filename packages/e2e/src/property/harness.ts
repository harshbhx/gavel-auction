import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { Parameters } from 'fast-check';

const DEFAULT_NUM_RUNS = 200;

/** The pinned seed: GAVEL_PROPERTY_SEED, or FC_SEED as an older alias. A bad value is an error. */
function parseSeed(): number | undefined {
  const name = process.env['GAVEL_PROPERTY_SEED'] !== undefined ? 'GAVEL_PROPERTY_SEED' : 'FC_SEED';
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return n;
}

/** One seed per test file: the pinned one, or a fresh one that is printed so a run can be replayed. */
const SEED = parseSeed() ?? Math.floor(Math.random() * 2 ** 31);
console.log(`property seed=${SEED} (replay with GAVEL_PROPERTY_SEED=${SEED})`);

/** Where committed counterexamples live: one JSON file per failure, see RegressionEntry. */
export const REGRESSION_DIR = fileURLToPath(new URL('../../fixtures/regressions', import.meta.url));

export interface RegressionEntry<T = unknown> {
  /** The seed of the run that found it, kept for the record. */
  readonly seed: number;
  /** The fast-check path of the counterexample, kept for the record. */
  readonly path: number[];
  /** The full name of the failing test, as vitest reports it ("describe > it"). */
  readonly property: string;
  /** The arguments of the property that failed, in order. Replayed as a fast-check example. */
  readonly value: T[];
}

function isRegressionEntry(v: unknown): v is RegressionEntry {
  if (typeof v !== 'object' || v === null) return false;
  const rec = v as Record<string, unknown>;
  return (
    typeof rec['seed'] === 'number' &&
    Array.isArray(rec['path']) &&
    rec['path'].every((n) => typeof n === 'number') &&
    typeof rec['property'] === 'string' &&
    rec['property'] !== '' &&
    Array.isArray(rec['value'])
  );
}

/**
 * Reads every committed counterexample. A missing folder means none were committed; a file that
 * is not JSON or has the wrong shape is an error, so a typo cannot silently drop a regression.
 */
export function loadRegressions<T = unknown>(fixtureDir: string): RegressionEntry<T>[] {
  let files: string[];
  try {
    files = readdirSync(fixtureDir)
      .filter((f) => f.endsWith('.json'))
      .sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const entries: RegressionEntry<T>[] = [];
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(resolve(fixtureDir, file), 'utf8'));
    } catch (e) {
      throw new Error(`regression ${file}: not valid JSON (${(e as Error).message})`);
    }
    if (!isRegressionEntry(parsed)) {
      throw new Error(
        `regression ${file}: needs numeric seed, numeric path array, property name and value array`,
      );
    }
    entries.push(parsed as RegressionEntry<T>);
  }
  return entries;
}

/** The stored argument tuples for one property, to pass to fast-check as `examples`. */
export function regressionExamples(dir: string, property: string): unknown[][] {
  return loadRegressions<unknown>(dir)
    .filter((r) => r.property === property)
    .map((r) => r.value);
}

function currentTestName(): string {
  try {
    return expect.getState().currentTestName ?? '';
  } catch {
    return '';
  }
}

export function propertyParams(
  overrides: Partial<Parameters<unknown[]>> = {},
  regressionDir: string = REGRESSION_DIR,
): Parameters<unknown[]> {
  const name = currentTestName();
  const stored = name === '' ? [] : regressionExamples(regressionDir, name);
  return {
    numRuns: DEFAULT_NUM_RUNS,
    seed: SEED,
    // Committed counterexamples run first on every run, whatever the random seed is.
    examples: stored as [unknown][],
    reporter(out) {
      if (out.failed) {
        console.error(`Property failed! Replay with GAVEL_PROPERTY_SEED=${String(out.seed)}`);
        console.error(`Counterexample: ${JSON.stringify(out.counterexample)}`);
        console.error(
          `To keep it, commit this as packages/e2e/fixtures/regressions/<name>.json: ${JSON.stringify({
            seed: out.seed,
            path: String(out.counterexamplePath ?? '')
              .split(':')
              .filter((p) => p !== '')
              .map(Number),
            property: name,
            value: out.counterexample,
          })}`,
        );
      }
    },
    ...overrides,
  };
}
