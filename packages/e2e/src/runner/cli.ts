import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenarioFile } from '../dsl/load';
import { runScenarioInProc, toNdjson } from './inproc';

/**
 * Usage: runner <scenario.yaml | folder> [--seed N] [--trace DIR]
 * Runs each scenario in process, writes an NDJSON trace per scenario when --trace is given, prints
 * a diff for every failed expectation and exits 1 if any scenario failed.
 */

interface Args {
  targets: string[];
  seed?: number;
  traceDir?: string;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { targets: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] as string;
    if (a === '--seed') {
      const n = Number(argv[(i += 1)]);
      if (!Number.isInteger(n)) throw new Error('--seed needs an integer');
      args.seed = n;
    } else if (a === '--trace') {
      const dir = argv[(i += 1)];
      if (dir === undefined || dir === '') throw new Error('--trace needs a folder');
      args.traceDir = dir;
    } else if (a.startsWith('--')) {
      throw new Error(`unknown flag ${a}`);
    } else {
      args.targets.push(a);
    }
  }
  return args;
}

function expand(target: string): string[] {
  const path = resolve(target);
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => join(path, f));
}

/** Returns the process exit code: 0 all passed, 1 a scenario failed, 2 bad usage. */
export async function main(argv: readonly string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }
  if (args.targets.length === 0) {
    process.stderr.write('usage: runner <scenario.yaml | folder> [--seed N] [--trace DIR]\n');
    return 2;
  }
  let failed = 0;
  for (const file of args.targets.flatMap(expand)) {
    const scenario = loadScenarioFile(file);
    const result = await runScenarioInProc(
      scenario,
      args.seed === undefined ? {} : { seed: args.seed },
    );
    if (args.traceDir !== undefined) {
      mkdirSync(args.traceDir, { recursive: true });
      const name = `${scenario.id || basename(file, '.yaml')}.ndjson`;
      writeFileSync(join(args.traceDir, name), toNdjson(result.trace));
    }
    if (result.failures.length === 0) {
      process.stdout.write(`PASS ${scenario.id} (seed ${result.seed})\n`);
    } else {
      failed += 1;
      process.stdout.write(`FAIL ${scenario.id} (seed ${result.seed})\n`);
      for (const f of result.failures) process.stdout.write(`${f}\n`);
    }
  }
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
      process.exitCode = 1;
    },
  );
}
