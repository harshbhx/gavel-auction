// Runs the e2e scenarios in process and writes one NDJSON trace per scenario.
// Usage (from packages/e2e): vite-node ../../scripts/hf/run-traces.mjs -- SCENARIO_DIR --trace OUT_DIR
// The runner's own command line entry does not start under vite-node, so this calls its main().
import { main } from '../../packages/e2e/src/runner/cli';

process.exitCode = await main(process.argv.slice(2));
