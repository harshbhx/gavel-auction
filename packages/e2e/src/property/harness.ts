import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

export function propertyParams(
  overrides: Partial<Parameters<unknown[]>> = {},
): Parameters<unknown[]> {
  return {
    numRuns: DEFAULT_NUM_RUNS,
    seed: SEED,
    reporter(out) {
      if (out.failed) {
        const s = out.seed;
        console.error(`Property failed! Replay with GAVEL_PROPERTY_SEED=${String(s)}`);
        console.error(`Counterexample: ${JSON.stringify(out.counterexample)}`);
      }
    },
    ...overrides,
  };
}

export interface RegressionEntry<T = unknown> {
  readonly seed: number;
  readonly path: number[];
  readonly value: T;
}

export function loadRegressions<T = unknown>(fixtureDir: string): RegressionEntry<T>[] {
  let files: string[];
  try {
    files = readdirSync(fixtureDir)
      .filter((f) => f.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
  const entries: RegressionEntry<T>[] = [];
  for (const file of files) {
    const raw = readFileSync(resolve(fixtureDir, file), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (isRegressionEntry(parsed)) {
      entries.push(parsed as RegressionEntry<T>);
    }
  }
  return entries;
}

function isRegressionEntry(v: unknown): v is RegressionEntry {
  if (typeof v !== 'object' || v === null) return false;
  const rec = v as Record<string, unknown>;
  return typeof rec['seed'] === 'number' && Array.isArray(rec['path']) && 'value' in rec;
}
