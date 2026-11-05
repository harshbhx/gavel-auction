import { appendFileSync } from 'node:fs';
import { sandboxAvailability } from '../sandbox/harness.js';
import { buildSandboxReport, readResults, renderSummary, writeSandboxReport } from './sandbox.js';

// Writes report/sandbox.json from the result files of the specs. Usage (from packages/e2e):
//   vite-node src/report/sandbox-cli.ts
// The job summary file named by GITHUB_STEP_SUMMARY gets the table when that variable is set.

const env = process.env;
const report = buildSandboxReport({
  generatedAt: new Date().toISOString(),
  sha: (env['GITHUB_SHA'] ?? 'local').slice(0, 12),
  secretsPresent: sandboxAvailability(env).ok,
  results: readResults('report/sandbox/results'),
});
writeSandboxReport('report/sandbox.json', report);
const summary = env['GITHUB_STEP_SUMMARY'];
if (summary !== undefined && summary !== '') appendFileSync(summary, renderSummary(report));
console.log(`sandbox report: ${report.overall} (${JSON.stringify(report.counts)})`);
