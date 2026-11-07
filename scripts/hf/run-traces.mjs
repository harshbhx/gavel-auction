// Runs the e2e scenarios in process, one at a time, and writes one NDJSON trace per scenario.
// Usage (from packages/e2e): vite-node ../../scripts/hf/run-traces.mjs -- SCENARIO_DIR --trace OUT_DIR
// The runner's own command line entry does not start under vite-node, so this calls its main().
// A scenario that the in-process runner cannot drive (it throws "not supported") is listed as
// skipped and left out; any other failure fails the run.
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { main } from '../../packages/e2e/src/runner/cli';

const [dir, flag, out] = process.argv.slice(2);
if (dir === undefined || flag !== '--trace' || out === undefined) {
  process.stderr.write('usage: run-traces.mjs SCENARIO_DIR --trace OUT_DIR\n');
  process.exit(2);
}
const files = readdirSync(resolve(dir))
  .filter((f) => f.endsWith('.yaml'))
  .sort();
let failed = 0;
for (const f of files) {
  try {
    const code = await main([join(resolve(dir), f), '--trace', resolve(out)]);
    if (code !== 0) failed += 1;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not supported by the in-process runner/.test(msg)) {
      process.stdout.write(`SKIPPED ${f}: ${msg}\n`);
    } else {
      process.stderr.write(`${f}: ${msg}\n`);
      failed += 1;
    }
  }
}
process.exitCode = failed === 0 ? 0 : 1;
