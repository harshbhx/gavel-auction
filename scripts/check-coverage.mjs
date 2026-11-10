#!/usr/bin/env node
// Per-package coverage gates (R-QA-021).
//
//   node scripts/check-coverage.mjs                    check coverage/coverage-summary.json
//   node scripts/check-coverage.mjs --skip-unchanged <ref>
//                                                      exit 0 when no coverage-relevant file changed since <ref>
//   node scripts/check-coverage.mjs --ratchet <ref>    fail when a threshold is lower than at <ref>
//                                                      unless docs/DECISIONS.md gained a new D-id entry
//                                                      naming each lowered package, metric and value
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const THRESHOLDS = join(root, 'coverage.thresholds.json');
const SUMMARY = join(root, 'coverage', 'coverage-summary.json');
const METRICS = ['lines', 'branches'];
const RELEVANT =
  /^(packages\/|vitest\.config\.ts$|coverage\.thresholds\.json$|scripts\/check-coverage\.mjs$|package(-lock)?\.json$)/;

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

/** Evaluates every configured package against its gate. A package with no sources fails. */
export function evaluate(summary, thresholds) {
  const agg = aggregate(summary, Object.keys(thresholds));
  const rows = [];
  let failed = false;
  for (const [pkg, gate] of Object.entries(thresholds)) {
    const a = agg[pkg];
    if (a.files === 0) {
      failed = true;
      rows.push([pkg, '-', '-', '-', 'FAIL (no instrumented sources)']);
      continue;
    }
    for (const k of METRICS) {
      const actual = pct(a[k].c, a[k].t);
      const ok = actual + 1e-9 >= gate[k];
      if (!ok) failed = true;
      rows.push([pkg, k, `${actual.toFixed(2)}%`, `${gate[k]}%`, ok ? 'ok' : 'FAIL']);
    }
  }
  return { rows, failed };
}

function checkCoverage() {
  const thresholds = readThresholds();
  if (!existsSync(SUMMARY)) {
    console.error('coverage/coverage-summary.json not found; run vitest with --coverage first');
    return 1;
  }
  const summary = JSON.parse(readFileSync(SUMMARY, 'utf8'));
  const { rows, failed } = evaluate(summary, thresholds);
  const out = table(rows);
  if (failed) console.error(`coverage gates failed:\n${out}`);
  else console.log(`coverage gates:\n${out}`);
  return failed ? 1 : 0;
}

// A lowering is documented only by a newly added "## D-NNNN" entry (outside
// fenced blocks) whose body names the package, the metric and the new value.
export function ratchetDocumented(diff, lowered) {
  const sections = [];
  let fenced = false;
  for (const raw of diff.split('\n')) {
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    const line = raw.slice(1);
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (/^##\s+D-\d+/.test(line)) sections.push([line]);
    else if (/^#{1,6}\s/.test(line)) sections.push(null);
    else if (sections.length > 0 && sections[sections.length - 1]) {
      sections[sections.length - 1].push(line);
    }
  }
  const bodies = sections.filter(Boolean).map((s) => s.join('\n'));
  const mentions = (text, word) => new RegExp(`(^|[^\\w])${word}([^\\w]|$)`, 'i').test(text);
  return lowered.every((i) =>
    bodies.some(
      (b) =>
        mentions(b, i.pkg) &&
        mentions(b, i.metric) &&
        mentions(b, i.next === undefined ? 'removed' : String(i.next)),
    ),
  );
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
  const items = [];
  for (const [pkg, gate] of Object.entries(base)) {
    for (const k of METRICS) {
      const next = now[pkg]?.[k];
      if (next === undefined || next < gate[k]) items.push({ pkg, metric: k, from: gate[k], next });
    }
  }
  const lowered = items.map((i) => `${i.pkg}.${i.metric}: ${i.from} -> ${i.next ?? 'removed'}`);
  if (lowered.length === 0) {
    console.log('ratchet: no threshold lowered');
    return 0;
  }
  let documented = false;
  try {
    const diff = git('diff', `${ref}...HEAD`, '--', 'docs/DECISIONS.md');
    documented = ratchetDocumented(diff, items);
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
    `ratchet: thresholds may only be raised. Lowered without a new "## D-NNNN" entry in docs/DECISIONS.md naming each package, metric and new value:\n  ${lowered.join('\n  ')}`,
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
