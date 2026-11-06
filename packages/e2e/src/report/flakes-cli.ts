import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { emptyLog, findFlakes, recordFlakes } from './flakes.js';
import type { FlakeLog, TestOutcome } from './flakes.js';

// Records the retried tests of one run in the flake log. Usage (from the repository root):
//   vite-node packages/e2e/src/report/flakes-cli.ts -- <flakes.json> <outcomes.json>
// flakes.json is read when present and rewritten. Tests quarantined by this run are written to
// newly-quarantined.txt next to it, one title per line.

const args = process.argv.slice(2).filter((a) => a !== '--');
const logPath = args[0] ?? 'report/flakes.json';
const outcomesPath = args[1] ?? 'report/in/outcomes.json';

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function isLog(value: unknown): value is FlakeLog {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v['flakes']) && Array.isArray(v['quarantined']);
}

function isOutcome(value: unknown): value is TestOutcome {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['test'] === 'string' &&
    typeof v['retries'] === 'number' &&
    typeof v['passed'] === 'boolean'
  );
}

const loaded = existsSync(logPath) ? readJson(logPath) : undefined;
const log = isLog(loaded) ? loaded : emptyLog();
const rawOutcomes = existsSync(outcomesPath) ? readJson(outcomesPath) : undefined;
const outcomes = Array.isArray(rawOutcomes) ? rawOutcomes.filter(isOutcome) : [];

const result = recordFlakes(log, findFlakes(outcomes), new Date());
mkdirSync(dirname(logPath), { recursive: true });
writeFileSync(logPath, `${JSON.stringify(result.log, null, 2)}\n`);
if (result.newlyQuarantined.length > 0) {
  writeFileSync(
    join(dirname(logPath), 'newly-quarantined.txt'),
    `${result.newlyQuarantined.join('\n')}\n`,
  );
}
console.log(
  `flakes recorded: ${findFlakes(outcomes).length}, newly quarantined: ${result.newlyQuarantined.length}`,
);
