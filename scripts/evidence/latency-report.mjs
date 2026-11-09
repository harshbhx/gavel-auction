// Turns the raw output of `measure:sandbox` (per-call) and `measure:settlement` (hammer to
// CAPTURED / SETTLED) into one evidence file with the sample sizes, p50/p95/p99/max, the
// targets and a verdict per target (issue 2183). Targets are never changed to fit: they are
// the ones in docs/GATES.md (hammer to CAPTURED p95 2500 ms, hammer to SETTLED p95 6000 ms,
// 1000 ms p95 per call in docs/DEMO.md).
// Run: node scripts/evidence/latency-report.mjs --dir <measure dir> --out <dir> [--run-url <url>]
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import {
  mdTable,
  parseFlags,
  readJsonIfPresent,
  verdictLine,
  writeEvidence,
  sha256,
} from './lib.mjs';
import { readFileSync } from 'node:fs';

export const TARGETS = { capturedP95Ms: 2500, settledP95Ms: 6000, callP95Ms: 1000 };
/** Below this many samples a p95 is not a measurement (the p95 of n=20 is the 19th value). */
export const MIN_SAMPLES = 40;
const OPS = ['order', 'authorize', 'capture', 'void'];

function status(p95, target) {
  return p95 <= target ? 'MET' : 'MISSED';
}

/**
 * Builds the evidence object from the two parsed tool outputs (either may be undefined).
 * `sources` carries the sha256 of each raw input file.
 */
export function buildLatencyEvidence({ calls, settlement, sources = {}, runUrl = '' }) {
  const problems = [];
  const out = { v: 1, kind: 'latency-evidence', runUrl, targets: TARGETS, sources, problems };

  if (calls === undefined) problems.push('per-call measurement missing');
  else {
    const ops = {};
    for (const op of OPS) {
      const p = calls.ops?.[op];
      if (p === undefined) {
        problems.push(`per-call ${op} missing`);
        continue;
      }
      ops[op] = { ...p, budgetP95Ms: TARGETS.callP95Ms, status: status(p.p95, TARGETS.callP95Ms) };
      if (p.count < MIN_SAMPLES)
        problems.push(`per-call ${op} n=${p.count} is below ${MIN_SAMPLES}`);
      if (p.failures > 0) problems.push(`per-call ${op} had ${p.failures} failed calls`);
    }
    out.calls = {
      cycles: calls.cycles,
      completed: calls.completed,
      ops,
      count429: calls.count429 ?? 0,
    };
    if (calls.completed !== calls.cycles) problems.push('not every per-call cycle completed');
  }

  if (settlement === undefined) problems.push('settlement measurement missing');
  else {
    const cap = settlement.hammerToCaptured;
    const set = settlement.hammerToSettled;
    out.settlement = {
      settlements: settlement.settlements,
      holdsPerSettlement: settlement.holdsPerSettlement,
      authorizationsUsed: settlement.authorizationsUsed,
      mismatches: settlement.mismatches,
      errors: settlement.errors,
      hammerToCaptured: {
        ...cap,
        targetP95Ms: TARGETS.capturedP95Ms,
        status: status(cap.p95, TARGETS.capturedP95Ms),
      },
      hammerToSettled: {
        ...set,
        targetP95Ms: TARGETS.settledP95Ms,
        status: status(set.p95, TARGETS.settledP95Ms),
      },
    };
    if (cap.count < MIN_SAMPLES) problems.push(`settlement n=${cap.count} is below ${MIN_SAMPLES}`);
    if (settlement.mismatches > 0 || settlement.errors > 0) {
      problems.push(
        `settlement had ${settlement.mismatches} mismatches and ${settlement.errors} errors`,
      );
    }
  }
  out.verdict = problems.length === 0 ? 'RECORDED' : 'INCOMPLETE';
  return out;
}

export function renderLatencyMarkdown(ev) {
  const lines = [`# Latency evidence: ${ev.verdict}`, ''];
  if (ev.runUrl !== '') lines.push(`Run: ${ev.runUrl}`, '');
  if (ev.calls !== undefined) {
    lines.push(`## Per call (${ev.calls.completed} of ${ev.calls.cycles} cycles completed)`, '');
    lines.push(
      mdTable(
        ['call', 'n', 'failed', 'p50 ms', 'p95 ms', 'p99 ms', 'max ms', 'p95 vs 1000 ms'],
        Object.entries(ev.calls.ops).map(([op, p]) => [
          op,
          p.count,
          p.failures,
          p.p50,
          p.p95,
          p.p99,
          p.max,
          p.status,
        ]),
      ),
      '',
    );
  }
  if (ev.settlement !== undefined) {
    const s = ev.settlement;
    lines.push(
      `## End to end (${s.settlements} settlements, ${s.holdsPerSettlement} holds each, ${s.authorizationsUsed} authorizations)`,
      '',
    );
    const row = (name, p) => [
      name,
      p.count,
      p.failures,
      p.p50,
      p.p95,
      p.p99,
      p.max,
      `${p.targetP95Ms} ms: ${p.status}`,
    ];
    lines.push(
      mdTable(
        ['span', 'n', 'failed', 'p50 ms', 'p95 ms', 'p99 ms', 'max ms', 'p95 target'],
        [
          row('hammer to CAPTURED', s.hammerToCaptured),
          row('hammer to SETTLED', s.hammerToSettled),
        ],
      ),
      '',
    );
  }
  if (ev.problems.length > 0)
    lines.push('## Problems', '', ...ev.problems.map((p) => `- ${p}`), '');
  return lines.join('\n');
}

/** The one-line verdict the workflow prints. */
export function latencyVerdictLine(ev) {
  const parts = [];
  const c = ev.settlement?.hammerToCaptured;
  const s = ev.settlement?.hammerToSettled;
  if (c) parts.push(`CAPTURED p95 ${c.p95} ms vs ${c.targetP95Ms}: ${c.status}, n=${c.count}`);
  if (s) parts.push(`SETTLED p95 ${s.p95} ms vs ${s.targetP95Ms}: ${s.status}, n=${s.count}`);
  const v = ev.calls?.ops?.void;
  if (v) parts.push(`void call p95 ${v.p95} ms vs ${v.budgetP95Ms}: ${v.status}, n=${v.count}`);
  if (ev.problems.length > 0) parts.push(`${ev.problems.length} problem(s)`);
  return verdictLine('LATENCY EVIDENCE', ev.verdict, parts.join('; '));
}

function main(argv) {
  const f = parseFlags(argv);
  if (f.dir === undefined || f.out === undefined) {
    console.error('usage: latency-report.mjs --dir <measure dir> --out <dir> [--run-url <url>]');
    return 2;
  }
  const read = (name) => {
    const path = join(f.dir, name);
    const json = readJsonIfPresent(path);
    return { json, hash: json === undefined ? undefined : sha256(readFileSync(path, 'utf8')) };
  };
  const calls = read('measure-sandbox.json');
  const settlement = read('measure-settlement.json');
  const sources = {};
  if (calls.hash) sources['measure-sandbox.json'] = calls.hash;
  if (settlement.hash) sources['measure-settlement.json'] = settlement.hash;
  const ev = buildLatencyEvidence({
    calls: calls.json,
    settlement: settlement.json,
    sources,
    runUrl: f['run-url'] ?? '',
  });
  const md = renderLatencyMarkdown(ev);
  writeEvidence(f.out, 'latency-evidence', ev, md);
  console.log(md);
  console.log(latencyVerdictLine(ev));
  return ev.verdict === 'RECORDED' ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
