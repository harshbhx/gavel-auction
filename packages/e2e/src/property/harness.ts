import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Parameters } from 'fast-check';

const DEFAULT_NUM_RUNS = 200;

function parseSeed(): number | undefined {
  const raw = process.env['FC_SEED'];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}

export function propertyParams(
  overrides: Partial<Parameters<unknown[]>> = {},
): Parameters<unknown[]> {
  const seed = parseSeed();
  return {
    numRuns: DEFAULT_NUM_RUNS,
    ...(seed !== undefined ? { seed } : {}),
    reporter(out) {
      if (out.failed) {
        const s = out.seed;
        console.error(`Property failed! Replay with FC_SEED=${String(s)}`);
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
