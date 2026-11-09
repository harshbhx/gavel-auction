// Pure helpers shared by scripts/hf/build-datasets.mjs and scripts/hf/check-evidence-coverage.mjs:
// they read the committed evidence under docs/evidence and the status lines of docs/GATES.md so the
// open datasets are derived from the repository, never from hand-copied inputs (issues 2321, 2322).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TARGETS, conservativeP95, targetStatus } from '../evidence/latency-report.mjs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** Every file under docs/evidence, recursively, any extension, as sorted repository paths. */
export function walkEvidence(root) {
  const base = join(root, 'docs', 'evidence');
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(join(base, rel)).sort()) {
      const r = rel === '' ? name : `${rel}/${name}`;
      if (statSync(join(base, r)).isDirectory()) walk(r);
      else out.push(`docs/evidence/${r}`);
    }
  };
  walk('');
  return out;
}

/** G0 to G5 for the gate folders (G3-early belongs to G3), else the first folder name. */
export function evidenceGroup(path) {
  const seg = path.split('/')[2] ?? 'evidence';
  const g = /^(G\d)(?:-|$)/.exec(seg);
  return g === null ? (path.split('/').length > 3 ? seg : 'evidence') : g[1];
}

/** sha256 values docs/GATES.md writes next to a file name: `name (sha256 H)` or `name with sha256 H`. */
export function parseClaims(text, files) {
  const claims = new Map();
  const re =
    /([A-Za-z0-9_.\/-]+\.(?:jsonl?|md|txt|csv|log))`?(?: \(sha256:? | with sha256 )([0-9a-f]{64})/g;
  for (const m of text.matchAll(re)) {
    const token = m[1];
    const hits = token.includes('/')
      ? files.filter((f) => f === token || f.endsWith(`/${token}`))
      : files.filter((f) => f.split('/').pop() === token);
    if (hits.length !== 1) continue; // ambiguous or not an evidence file: no claim is attributed
    const list = claims.get(hits[0]) ?? [];
    if (!list.includes(m[2])) list.push(m[2]);
    claims.set(hits[0], list);
  }
  return claims;
}

/** 7 Nov 2026 03:06 UTC -> 2026-11-07T03:06:00Z; a bare date or ISO date is kept as a date. */
export function parseDate(text) {
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  const long = new RegExp(
    `\\b(\\d{1,2}) (${MONTHS.join('|')})[a-z]* (\\d{4})(?: (\\d{2}:\\d{2}) UTC)?`,
  ).exec(text);
  const first = [iso, long].filter((x) => x !== null).sort((a, b) => a.index - b.index)[0];
  if (first === undefined) return null;
  if (first === iso) return first[1];
  const date = `${first[3]}-${String(MONTHS.indexOf(first[2]) + 1).padStart(2, '0')}-${first[1].padStart(2, '0')}`;
  return first[4] === undefined ? date : `${date}T${first[4]}:00Z`;
}

/**
 * The status a gate reads, taken from its docs/GATES.md lines. A gate whose status line says
 * NOT RUN while its run line starts with IN PROGRESS (a probe that is still running) reads
 * IN PROGRESS; when GATES.md records a result, that result is what the dataset shows.
 */
export function gateStatus(g) {
  if (g.status === 'NOT RUN' && /^IN PROGRESS\b/.test(g.runLine)) {
    return {
      status: 'IN PROGRESS',
      note: `docs/GATES.md: ${g.runLine.split(/\.\s/)[0].slice(0, 200)}`,
    };
  }
  return { status: g.status, note: null };
}

/** Settlement and per-call runs from the committed latency evidence (docs/evidence/latency, measure). */
export function loadLatencyRuns(root, gatesText) {
  const ev = join(root, 'docs', 'evidence');
  // A date counts only when it is written within 150 characters after the run id on the same line.
  const dateFor = (id) => {
    for (const line of gatesText.split('\n')) {
      const at = line.indexOf(id);
      if (at < 0) continue;
      const d = parseDate(line.slice(at, at + 150));
      if (d !== null) return d.slice(0, 10);
    }
    return null;
  };
  const settlements = [];
  const calls = [];
  const latDir = join(ev, 'latency');
  let latRunId = null;
  const evFile = join(latDir, 'latency-evidence.json');
  if (existsSync(evFile)) {
    latRunId = /\/runs\/(\d+)/.exec(readJson(evFile).runUrl ?? '')?.[1] ?? null;
    if (latRunId === null)
      throw new Error('docs/evidence/latency/latency-evidence.json has no runUrl');
  }
  const targets = existsSync(evFile) ? (readJson(evFile).targets ?? TARGETS) : TARGETS;
  for (const dir of ['latency', 'measure']) {
    const d = join(ev, dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)
      .filter((n) => n.endsWith('.json'))
      .sort()) {
      const j = readJson(join(d, f));
      const path = `docs/evidence/${dir}/${f}`;
      if (j.hammerToSettled !== undefined && j.settlements !== undefined) {
        let id = dir === 'latency' ? latRunId : null;
        if (id === null) {
          const line = gatesText
            .split('\n')
            .find((l) => l.includes(`docs/evidence/${dir}/`) && /\brun (\d{8,})/.test(l));
          id = line === undefined ? null : /\brun (\d{8,})/.exec(line)[1];
        }
        if (id === null) throw new Error(`${path}: cannot tell which workflow run produced it`);
        settlements.push({ id, path, date: dateFor(id), report: j, targets });
      } else if (
        j.ops !== undefined &&
        j.cycles !== undefined &&
        latRunId !== null &&
        dir === 'latency'
      ) {
        calls.push({ id: latRunId, path, date: dateFor(latRunId), report: j, targets });
      }
    }
  }
  settlements.sort((a, b) => Number(a.id) - Number(b.id));
  return { settlements, calls };
}

const verdict = (p, target) => {
  const status = targetStatus(p.p95, target, p.failures);
  const c = conservativeP95(p);
  return {
    attempts: c.attempts,
    p95_all_attempts_ms: c.value,
    target_p95_ms: target,
    met: status === 'MET',
    status,
  };
};

/** Rows for settlement_spans and api_calls, with attempts, failures and a worst-case p95 on every row. */
export function latencyRows({ settlements, calls }) {
  const spanRows = [];
  for (const run of settlements) {
    const r = run.report;
    for (const [span, key, target] of [
      ['hammer_to_captured', 'hammerToCaptured', run.targets.capturedP95Ms],
      ['hammer_to_settled', 'hammerToSettled', run.targets.settledP95Ms],
    ]) {
      const s = r[key];
      spanRows.push({
        run_id: Number(run.id),
        run_label: `${r.settlements} settlements`,
        run_date: run.date,
        span,
        n: s.count,
        failures: s.failures,
        ...verdict(s, target),
        min_ms: s.min,
        p50_ms: s.p50,
        p95_ms: s.p95,
        p99_ms: s.p99,
        max_ms: s.max,
        holds_per_settlement: r.holdsPerSettlement,
        void_concurrency: r.voidConcurrency,
        mismatches: r.mismatches,
        errors: r.errors,
        source_path: run.path,
      });
    }
  }
  const callRows = [];
  for (const run of calls) {
    for (const [call, s] of Object.entries(run.report.ops)) {
      callRows.push({
        run_id: Number(run.id),
        run_date: run.date,
        call,
        n: s.count,
        failures: s.failures,
        ...verdict(s, run.targets.callP95Ms),
        min_ms: s.min,
        p50_ms: s.p50,
        p95_ms: s.p95,
        p99_ms: s.p99,
        max_ms: s.max,
        cycles: run.report.cycles,
        source_path: run.path,
      });
    }
  }
  return { spanRows, callRows };
}
