#!/usr/bin/env node
// Dependency audit gate with expiring waivers (T-QA-077).
// Usage: node scripts/check-audit.mjs [--input <audit.json>] [--waivers <file>] [--level <severity>]
//        [--now <iso date>]
// Without --input it runs `npm audit --json`. Exit 0 when every advisory at or above the level is
// covered by a waiver that has not expired and no waiver has expired; exit 1 otherwise.
// A waiver is { "advisory": "GHSA-...", "reason": "...", "expires": "YYYY-MM-DD" }.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** A waiver may not be written for longer than this, so none becomes permanent by accident. */
export const MAX_WAIVER_DAYS = 90;

function ghsaOf(url) {
  const m = typeof url === 'string' ? /(GHSA-[a-z0-9-]+)$/i.exec(url) : null;
  return m ? m[1].toLowerCase() : undefined;
}

/** Advisory ids behind one npm audit vulnerability entry (direct advisories only). */
export function advisoriesOf(vuln) {
  const ids = [];
  for (const via of Array.isArray(vuln.via) ? vuln.via : []) {
    if (via === null || typeof via !== 'object') continue;
    const id = ghsaOf(via.url) ?? (via.source === undefined ? undefined : String(via.source));
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

/** Problems with the waiver list itself: shape, date format and the lifetime cap. */
export function checkWaivers(waivers, nowMs) {
  const problems = [];
  for (const [i, w] of waivers.entries()) {
    const label = `waiver ${i + 1}`;
    if (w === null || typeof w !== 'object') {
      problems.push(`${label}: not an object`);
      continue;
    }
    if (typeof w.advisory !== 'string' || w.advisory === '') problems.push(`${label}: no advisory`);
    if (typeof w.reason !== 'string' || w.reason.trim() === '')
      problems.push(`${label}: no reason`);
    if (typeof w.expires !== 'string' || !DATE_ONLY.test(w.expires)) {
      problems.push(`${label}: expires must be YYYY-MM-DD`);
      continue;
    }
    const end = Date.parse(`${w.expires}T23:59:59Z`);
    if (Number.isNaN(end)) problems.push(`${label}: expires is not a date`);
    else if (end < nowMs) problems.push(`${label}: expired on ${w.expires} (${w.advisory})`);
    else if (end - nowMs > MAX_WAIVER_DAYS * 86_400_000) {
      problems.push(`${label}: expires more than ${MAX_WAIVER_DAYS} days ahead`);
    }
  }
  return problems;
}

/**
 * Compares an `npm audit --json` report with the waivers.
 * Returns { failures, waived }; failures is empty when the gate passes.
 */
export function evaluate(report, waivers, { nowMs, level = 'high' } = {}) {
  const now = nowMs ?? Date.now();
  const failures = checkWaivers(waivers, now);
  const active = new Set(
    waivers
      .filter(
        (w) =>
          w &&
          typeof w.advisory === 'string' &&
          isDateOnly(w.expires) &&
          Date.parse(`${w.expires}T23:59:59Z`) >= now,
      )
      .map((w) => w.advisory.toLowerCase()),
  );
  const min = SEVERITIES.indexOf(level);
  const waived = [];
  const vulns = report && typeof report === 'object' ? (report.vulnerabilities ?? {}) : {};
  for (const [name, vuln] of Object.entries(vulns)) {
    if (SEVERITIES.indexOf(vuln.severity) < min) continue;
    const ids = advisoriesOf(vuln);
    // An entry that only points at other packages is reported through those packages.
    if (ids.length === 0) continue;
    const open = ids.filter((id) => !active.has(id.toLowerCase()));
    if (open.length === 0) waived.push(name);
    else failures.push(`${name} (${vuln.severity}): ${open.join(', ')}`);
  }
  if (report && typeof report === 'object' && report.error) {
    failures.push('npm audit reported an error: ' + String(report.error.summary ?? 'unknown'));
  }
  return { failures, waived };
}

function isDateOnly(v) {
  return typeof v === 'string' && DATE_ONLY.test(v);
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv) {
  const waiversFile = arg(argv, '--waivers') ?? 'audit-waivers.json';
  const level = arg(argv, '--level') ?? 'high';
  const nowArg = arg(argv, '--now');
  const input = arg(argv, '--input');
  if (!SEVERITIES.includes(level)) {
    console.error(`unknown level ${level}`);
    return 2;
  }
  let waivers;
  try {
    const parsed = JSON.parse(readFileSync(waiversFile, 'utf8'));
    waivers = Array.isArray(parsed.waivers) ? parsed.waivers : [];
  } catch (e) {
    console.error(`cannot read ${waiversFile}: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  let text;
  if (input !== undefined) text = readFileSync(input, 'utf8');
  else {
    const run = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 });
    text = run.stdout;
  }
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    console.error('npm audit did not return JSON');
    return 2;
  }
  const nowMs = nowArg === undefined ? Date.now() : Date.parse(`${nowArg}T00:00:00Z`);
  const { failures, waived } = evaluate(report, waivers, { nowMs, level });
  for (const w of waived) console.log(`waived: ${w}`);
  for (const f of failures) console.error(`audit: ${f}`);
  if (failures.length === 0) console.log('audit gate passed');
  return failures.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
