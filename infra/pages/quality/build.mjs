// Builds the /quality page (R-QA-032): summary.json and index.html for one commit.
// Run from the repository root:
//   GAVEL_SHA=<sha> npx vite-node infra/pages/quality/build.mjs -- <outDir> [inputs.json]
// inputs.json holds the per-layer counts (the ReportInputs shape without sha and builtAt).
// A missing layer shows as n/a on the page.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSummary,
  loadTemplate,
  renderHtml,
  validateSummary,
} from '../../../packages/e2e/src/report/build.ts';

const args = process.argv.slice(2).filter((a) => a !== '--');
const outDir = args[0] ?? 'quality-out';
const inputsPath = args[1];
const sha = process.env.GAVEL_SHA ?? '';
if (!/^[0-9a-f]{7,40}$/.test(sha)) {
  process.stderr.write('GAVEL_SHA must be a hex commit id\n');
  process.exit(2);
}
const extra = inputsPath === undefined ? {} : JSON.parse(readFileSync(inputsPath, 'utf8'));
const summary = buildSummary({ ...extra, sha, builtAt: new Date().toISOString() });
const problems = validateSummary(JSON.parse(JSON.stringify(summary)));
if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(outDir, 'index.html'), renderHtml(summary, loadTemplate()));
process.stdout.write(`quality report for ${sha} written to ${outDir}\n`);
