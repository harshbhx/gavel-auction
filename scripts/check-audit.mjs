#!/usr/bin/env node
// Dependency audit gate (R-QA-036, SEC-12). Usage: node scripts/check-audit.mjs [--report file]
// Runs `npm audit --json` (or reads a saved report) and fails on any high or critical
// advisory that has no waiver. A waiver lists the package, a reason and an expiry date
// (YYYY-MM-DD, UTC); once the date has passed the waiver no longer counts and is reported.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BLOCKING = new Set(['high', 'critical']);

/** Waiver is active while now is before the end of its expiry day (UTC). */
export function activeWaivers(waivers, nowMs) {
  const active = new Map();
  const expired = [];
  for (const w of waivers) {
    const end = Date.parse(`${w.expires}T23:59:59.999Z`);
    if (Number.isNaN(end)) throw new Error(`waiver for ${w.package}: bad expires "${w.expires}"`);
    if (typeof w.reason !== 'string' || w.reason.trim() === '') {
      throw new Error(`waiver for ${w.package}: reason is required`);
    }
    if (nowMs <= end) active.set(w.package, w);
    else expired.push(w);
  }
  return { active, expired };
}

/** Returns { ok, blocking, waived, expired } for an npm audit JSON report. */
export function evaluateAudit(report, waivers, nowMs) {
  const { active, expired } = activeWaivers(waivers, nowMs);
  const vulns = Object.values(report?.vulnerabilities ?? {});
  const blocking = [];
  const waived = [];
  for (const v of vulns) {
    if (!BLOCKING.has(v.severity)) continue;
    if (active.has(v.name)) waived.push(v.name);
    else blocking.push(`${v.name} (${v.severity})`);
  }
  const expiredHits = expired
    .filter((w) => vulns.some((v) => v.name === w.package && BLOCKING.has(v.severity)))
    .map((w) => `${w.package} (waiver expired ${w.expires})`);
  return { ok: blocking.length === 0, blocking, waived, expired: expiredHits };
}

function readReport(file) {
  if (file) return JSON.parse(readFileSync(file, 'utf8'));
  try {
    return JSON.parse(execFileSync('npm', ['audit', '--json'], { cwd: root, encoding: 'utf8' }));
  } catch (e) {
    // npm audit exits non-zero when it finds something but still prints the report.
    if (e.stdout) return JSON.parse(e.stdout);
    throw e;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--report');
  const file = i >= 0 ? process.argv[i + 1] : undefined;
  const waivers = JSON.parse(readFileSync(join(root, 'audit-waivers.json'), 'utf8')).waivers;
  const result = evaluateAudit(readReport(file), waivers, Date.now());
  for (const w of result.waived) console.log(`waived: ${w}`);
  for (const w of result.expired) console.error(`expired: ${w}`);
  for (const b of result.blocking) console.error(`blocking: ${b}`);
  if (!result.ok) process.exit(1);
  console.log('audit gate: ok');
}
