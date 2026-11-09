#!/usr/bin/env node
// Drift check for the open datasets (issue 2451). The lock file hf/datasets.lock.json records what a
// build from the committed evidence must contain: the row count of every table of gavel-latency and
// gavel-gates, and the path and sha256 of every evidence file. This script fails when a fresh build
// differs from the lock (evidence added, changed or removed without a rebuild) or when an evidence
// file is missing from the dataset. It never touches the network and never publishes.
// Usage: node scripts/hf/check-drift.mjs OUT_DIR           compare a build with the lock
//        node scripts/hf/check-drift.mjs OUT_DIR --write   rewrite the lock from a build
// OUT_DIR is the output of scripts/hf/build.sh built WITHOUT the optional inputs SIM_DIR, TRACE_DIR
// and ASSURANCE_FILE (those are produced by other jobs or by live API counts and are not locked).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkEvidence } from './evidence-index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK = join(ROOT, 'hf', 'datasets.lock.json');
const LOCKED = ['gavel-latency', 'gavel-gates'];
const LOCKED_TABLES = {
  'gavel-latency': ['settlement_spans.jsonl', 'api_calls.jsonl'],
  'gavel-gates': ['gates.jsonl', 'evidence_files.jsonl', 'nightly_results.jsonl'],
};
const readJsonl = (path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));

/** What the build in `out` contains, in the shape of the lock file. */
export function snapshot(out) {
  const datasets = {};
  for (const name of LOCKED) {
    const dir = join(out, name);
    const manifest = JSON.parse(readFileSync(join(dir, 'MANIFEST.json'), 'utf8'));
    const rows = {};
    for (const t of LOCKED_TABLES[name]) {
      const entry = manifest.files.find((f) => f.path === t);
      rows[t] = entry?.rows ?? null;
    }
    datasets[name] = { rows };
  }
  const files = readJsonl(join(out, 'gavel-gates', 'evidence_files.jsonl'))
    .map((r) => ({ path: r.path, sha256: r.sha256 }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  return { datasets, evidence_files: files };
}

/** Problems between the lock and a snapshot, plus evidence files the dataset does not list. */
export function compare(lock, snap, root = ROOT) {
  const problems = [];
  for (const name of LOCKED) {
    for (const t of LOCKED_TABLES[name]) {
      const want = lock.datasets?.[name]?.rows?.[t];
      const have = snap.datasets[name].rows[t];
      if (want !== have) problems.push(`${name}/${t}: lock has ${want} rows, build has ${have}`);
    }
  }
  const lockedFiles = new Map((lock.evidence_files ?? []).map((f) => [f.path, f.sha256]));
  const builtFiles = new Map(snap.evidence_files.map((f) => [f.path, f.sha256]));
  for (const [p, h] of builtFiles) {
    if (!lockedFiles.has(p)) problems.push(`evidence file ${p} is new and not in the lock`);
    else if (lockedFiles.get(p) !== h) problems.push(`evidence file ${p} changed (sha256 differs)`);
  }
  for (const p of lockedFiles.keys())
    if (!builtFiles.has(p)) problems.push(`evidence file ${p} is in the lock but not in the build`);
  for (const p of walkEvidence(root))
    if (!builtFiles.has(p))
      problems.push(`evidence file ${p} is committed but missing from gavel-gates`);
  return problems;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (out === undefined) {
    process.stderr.write('usage: check-drift.mjs OUT_DIR [--write]\n');
    process.exit(2);
  }
  const snap = snapshot(resolve(out));
  if (process.argv.includes('--write')) {
    writeFileSync(LOCK, JSON.stringify(snap, null, 2) + '\n');
    process.stdout.write(`wrote ${LOCK}\n`);
  } else {
    if (!existsSync(LOCK)) {
      process.stderr.write('hf/datasets.lock.json is missing\n');
      process.exit(1);
    }
    const problems = compare(JSON.parse(readFileSync(LOCK, 'utf8')), snap);
    if (problems.length > 0) {
      process.stderr.write(
        `hf drift: ${problems.length} problem(s)\n- ${problems.join('\n- ')}\n` +
          'Rebuild the datasets, run `node scripts/hf/check-drift.mjs OUT_DIR --write`, commit hf/datasets.lock.json, then republish (workflow hf-datasets, dry_run false).\n',
      );
      process.exit(1);
    }
    process.stdout.write('hf drift: the build matches hf/datasets.lock.json\n');
  }
}
