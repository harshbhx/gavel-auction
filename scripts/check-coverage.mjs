#!/usr/bin/env node
// Per-package coverage gates (R-QA-021).
//
//   node scripts/check-coverage.mjs                    check coverage/coverage-summary.json
//   node scripts/check-coverage.mjs --skip-unchanged <ref>
//                                                      exit 0 when no coverage-relevant file changed since <ref>
//   node scripts/check-coverage.mjs --ratchet <ref>    fail when a threshold is lower than at <ref>
//                                                      unless docs/DECISIONS.md gained a "coverage threshold" line
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const THRESHOLDS = join(root, 'coverage.thresholds.json');
const SUMMARY = join(root, 'coverage', 'coverage-summary.json');
const METRICS = ['lines', 'branches'];
const RELEVANT =
  /^(packages\/|vitest\.(workspace|config)\.ts$|coverage\.thresholds\.json$|scripts\/check-coverage\.mjs$|package(-lock)?\.json$)/;

function git(...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function readThresholds() {
  return JSON.parse(readFileSync(THRESHOLDS, 'utf8'));
}

function pct(covered, total) {
  return total === 0 ? 100 : (covered / total) * 100;
}

export function aggregate(summary, packages) {
  const acc = Object.fromEntries(
    packages.map((p) => [p, { lines: { c: 0, t: 0 }, branches: { c: 0, t: 0 }, files: 0 }]),
  );
  for (const [file, data] of Object.entries(summary)) {
    if (file === 'total') continue;
    const m = /[\\/]packages[\\/]([^\\/]+)[\\/]src[\\/]/.exec(file);
    const entry = m ? acc[m[1]] : undefined;
    if (!entry) continue;
    entry.files += 1;
    for (const k of METRICS) {
      entry[k].c += data[k].covered;
      entry[k].t += data[k].total;
    }
  }
  return acc;
}

function table(rows) {
  const head = ['package', 'metric', 'actual', 'gate', 'status'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const fmt = (r) => r.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  return [fmt(head), fmt(widths.map((w) => '-'.repeat(w))), ...rows.map(fmt)].join('\n');
}

function checkCoverage() {
  const thresholds = readThresholds();
  if (!existsSync(SUMMARY)) {
    console.error('coverage/coverage-summary.json not found; run vitest with --coverage first');
    return 1;
  }
  const summary = JSON.parse(readFileSync(SUMMARY, 'utf8'));
  const agg = aggregate(summary, Object.keys(thresholds));
  const rows = [];
  let failed = false;
  for (const [pkg, gate] of Object.entries(thresholds)) {
    const a = agg[pkg];
    if (a.files === 0) {
      rows.push([pkg, '-', '-', '-', 'skipped (no sources)']);
      continue;
    }
    for (const k of METRICS) {
      const actual = pct(a[k].c, a[k].t);
      const ok = actual + 1e-9 >= gate[k];
      if (!ok) failed = true;
      rows.push([pkg, k, `${actual.toFixed(2)}%`, `${gate[k]}%`, ok ? 'ok' : 'FAIL']);
    }
  }
  const out = table(rows);
  if (failed) console.error(`coverage gates failed:\n${out}`);
  else console.log(`coverage gates:\n${out}`);
  return failed ? 1 : 0;
}

function ratchet(ref) {
  let base;
  try {
    base = JSON.parse(git('show', `${ref}:coverage.thresholds.json`));
  } catch {
    console.log(`ratchet: no thresholds at ${ref}, nothing to compare`);
    return 0;
  }
  const now = readThresholds();
  const lowered = [];
  for (const [pkg, gate] of Object.entries(base)) {
    for (const k of METRICS) {
      const next = now[pkg]?.[k];
      if (next === undefined || next < gate[k])
        lowered.push(`${pkg}.${k}: ${gate[k]} -> ${next ?? 'removed'}`);
    }
  }
  if (lowered.length === 0) {
    console.log('ratchet: no threshold lowered');
    return 0;
  }
  let documented = false;
  try {
    const diff = git('diff', `${ref}...HEAD`, '--', 'docs/DECISIONS.md');
    documented = diff.split('\n').some((l) => l.startsWith('+') && /coverage threshold/i.test(l));
  } catch {
    documented = false;
  }
  if (documented) {
    console.log(
      `ratchet: lowered thresholds documented in docs/DECISIONS.md:\n  ${lowered.join('\n  ')}`,
    );
    return 0;
  }
  console.error(
    `ratchet: thresholds may only be raised. Lowered without a "coverage threshold" entry in docs/DECISIONS.md:\n  ${lowered.join('\n  ')}`,
  );
  return 1;
}

function skipUnchanged(ref) {
  try {
    const changed = git('diff', '--name-only', `${ref}...HEAD`).split('\n').filter(Boolean);
    if (!changed.some((f) => RELEVANT.test(f))) {
      console.log(`coverage: skipped, no package or config changes since ${ref}`);
      return true;
    }
  } catch {
    // No usable base: run the gate.
  }
  return false;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const skipRef = argValue('--skip-unchanged');
  if (skipRef && skipUnchanged(skipRef)) process.exit(0);
  const ratchetRef = argValue('--ratchet');
  if (ratchetRef) process.exit(ratchet(ratchetRef));
  process.exit(checkCoverage());
}
