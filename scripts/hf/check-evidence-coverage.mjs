#!/usr/bin/env node
// Dry-run check for the built datasets (issues 2321 and 2322): fails when the open data and the
// committed evidence disagree. Reads only the build output and the repository, never the network.
// Usage: node scripts/hf/check-evidence-coverage.mjs OUT_DIR
//   - every settlement run in docs/evidence/latency and docs/evidence/measure is a row of gavel-latency
//   - evidence_files has exactly one row for each file under docs/evidence
//   - the G3 row shows the status docs/GATES.md implies (no frozen override)
//   - no workers.dev link and none of the old hard-coded sentences in the built files
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateStatus, loadLatencyRuns, walkEvidence } from './evidence-index.mjs';
import { parseGates } from './build-datasets.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJsonl = (path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
const walk = (dir) =>
  readdirSync(dir).flatMap((n) =>
    statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)],
  );

export function check(out, root = ROOT) {
  const problems = [];
  const gatesText = readFileSync(join(root, 'docs', 'GATES.md'), 'utf8');
  const latDir = join(out, 'gavel-latency');
  if (existsSync(latDir)) {
    const runs = loadLatencyRuns(root, gatesText).settlements;
    const rows = readJsonl(join(latDir, 'settlement_spans.jsonl'));
    for (const r of runs) {
      for (const span of ['hammer_to_captured', 'hammer_to_settled']) {
        if (!rows.some((x) => String(x.run_id) === r.id && x.span === span))
          problems.push(`gavel-latency: run ${r.id} (${r.path}) has no ${span} row`);
      }
    }
  }
  const gatesDir = join(out, 'gavel-gates');
  if (existsSync(gatesDir)) {
    const want = walkEvidence(root);
    const have = readJsonl(join(gatesDir, 'evidence_files.jsonl')).map((r) => r.path);
    for (const p of want) if (!have.includes(p)) problems.push(`gavel-gates: ${p} is not indexed`);
    for (const p of have)
      if (!want.includes(p)) problems.push(`gavel-gates: ${p} is not committed`);
    if (have.length !== want.length)
      problems.push(`gavel-gates: ${have.length} indexed rows for ${want.length} evidence files`);
    const rows = readJsonl(join(gatesDir, 'gates.jsonl'));
    for (const g of parseGates(gatesText)) {
      const row = rows.find((r) => r.gate === g.id);
      if (row === undefined || row.status !== gateStatus(g).status)
        problems.push(
          `gavel-gates: ${g.id} shows ${row?.status}, docs/GATES.md implies ${gateStatus(g).status}`,
        );
    }
  }
  const banned = [/workers\.dev/, /G0 has no committed evidence/, /Small n: 3 and 20 settlements/];
  for (const f of walk(out).filter((n) => /\.(md|jsonl|csv|json|html)$/.test(n))) {
    const text = readFileSync(f, 'utf8');
    for (const re of banned)
      if (re.test(text)) problems.push(`${f.slice(out.length + 1)}: matches ${re}`);
  }
  return problems;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (out === undefined) {
    process.stderr.write('usage: check-evidence-coverage.mjs OUT_DIR\n');
    process.exit(2);
  }
  const problems = check(resolve(out));
  if (problems.length > 0) {
    process.stderr.write(
      `evidence coverage: ${problems.length} problem(s)\n- ${problems.join('\n- ')}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    'evidence coverage: every committed latency run and evidence file is in the build\n',
  );
}
