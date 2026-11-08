#!/usr/bin/env node
// Builds the Hugging Face Space `gavel-evidence-explorer` (static) from the built datasets.
// Usage: node scripts/hf/build-space.mjs DATASETS_DIR OUT_DIR
//   DATASETS_DIR  output of scripts/hf/build.sh (needs gavel-gates, gavel-latency, gavel-sim-30d,
//                 gavel-stt-bids)
//   OUT_DIR       receives hf/space/* (README.md with the Space header, index.html, assets) and
//                 data/explorer.json, the only data file the page reads.
// Every number in explorer.json is read from a dataset file, or from the G5 results table and the
// latency target table of docs/GATES.md (checked below). Nothing is typed in or invented; a missing
// input fails the build.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPACE_SRC = join(ROOT, 'hf', 'space');

const readJsonl = (p) =>
  readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));

function need(dir, name, file) {
  const p = join(dir, name, file);
  if (!existsSync(p)) throw new Error(`missing ${name}/${file}; build that dataset first`);
  return p;
}

/** The four rows of the G5 results table in docs/GATES.md (parse-level scores, not in the dataset). */
export function parseG5(gatesMd) {
  const rows = [];
  for (const line of gatesMd.split('\n')) {
    const m =
      /^\|\s*(eSpeak[^|]*|human-like[^|]*)\|\s*(Deepgram[^|]*|Groq[^|]*)\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*$/.exec(
        line,
      );
    if (m === null) continue;
    rows.push({
      clip_set: m[1].trim().startsWith('eSpeak') ? 'espeak' : 'human',
      clip_set_label: m[1].trim(),
      provider: m[2].trim(),
      n: Number(m[3]),
      exact: Number(m[4]),
      wrong_accept: Number(m[5]),
      confirm: Number(m[6]),
      missed_bid: Number(m[7]),
    });
  }
  if (rows.length !== 4) throw new Error(`expected 4 G5 rows in docs/GATES.md, found ${rows.length}`);
  return rows;
}

/** The two latency targets (R-PAY-152) from the target table in docs/GATES.md. */
export function parseTargets(gatesMd) {
  const cap = /\|\s*hammer to CAPTURED p95\s*\|\s*([\d.]+) s\s*\|/.exec(gatesMd);
  const set = /\|\s*hammer to SETTLED, 6 holds, p95\s*\|\s*([\d.]+) s\s*\|/.exec(gatesMd);
  if (cap === null || set === null) throw new Error('latency target rows not found in docs/GATES.md');
  return { captured_ms: Number(cap[1]) * 1000, settled_ms: Number(set[1]) * 1000 };
}

export function buildExplorer(datasetsDir) {
  const gatesMd = readFileSync(join(ROOT, 'docs', 'GATES.md'), 'utf8');
  const manifest = JSON.parse(readFileSync(need(datasetsDir, 'gavel-gates', 'MANIFEST.json'), 'utf8'));

  const gates = readJsonl(need(datasetsDir, 'gavel-gates', 'gates.jsonl')).map((g) => ({
    gate: g.gate,
    title: g.title,
    status: g.status,
    note: g.status_note,
    date_utc: g.date_utc,
    label: g.label,
  }));

  const spans = readJsonl(need(datasetsDir, 'gavel-latency', 'settlement_spans.jsonl')).map((r) => ({
    run_id: r.run_id,
    run_label: r.run_label,
    run_date: r.run_date,
    span: r.span,
    n: r.n,
    p50_ms: r.p50_ms,
    p95_ms: r.p95_ms,
    max_ms: r.max_ms,
  }));
  const calls = readJsonl(need(datasetsDir, 'gavel-latency', 'api_calls.jsonl')).map((r) => ({
    run_id: r.run_id,
    run_date: r.run_date,
    call: r.call,
    n: r.n,
    p50_ms: r.p50_ms,
    p95_ms: r.p95_ms,
  }));

  const lots = readJsonl(need(datasetsDir, 'gavel-sim-30d', 'lots.jsonl'));
  const holds = readJsonl(need(datasetsDir, 'gavel-sim-30d', 'holds.jsonl'));
  const scenarios = readJsonl(need(datasetsDir, 'gavel-sim-30d', 'scenarios.jsonl'));
  const tally = (key) => {
    const out = {};
    for (const l of lots) {
      const v = l[key];
      if (v === null || v === undefined) continue;
      out[v] = (out[v] ?? 0) + 1;
    }
    return out;
  };
  const sum = (f) => lots.reduce((a, l) => a + l[f], 0);
  const money = {
    held_cents: sum('held_cents'),
    captured_cents: sum('captured_cents'),
    released_cents: sum('released_cents'),
    open_cents: sum('open_cents'),
  };
  const sim = {
    lots: lots.length,
    holds: holds.length,
    status_counts: tally('status'),
    review_causes: tally('review_cause'),
    sold: lots.filter((l) => l.sold).length,
    crashes: sum('crashes'),
    money,
    balanced: money.held_cents === money.captured_cents + money.released_cents + money.open_cents,
    scenarios: scenarios.map((s) => ({
      scenario: s.scenario,
      title: s.title,
      checks: s.checks,
      checks_passed: s.checks_passed,
    })),
  };

  const stt = {
    scores: readJsonl(need(datasetsDir, 'gavel-stt-bids', 'scores.jsonl')),
    g5_table: parseG5(gatesMd),
  };

  const versions = {};
  for (const n of ['gavel-gates', 'gavel-latency', 'gavel-sim-30d', 'gavel-stt-bids']) {
    versions[n] = JSON.parse(readFileSync(need(datasetsDir, n, 'MANIFEST.json'), 'utf8')).version;
  }
  return {
    built_from: {
      repository: 'https://github.com/harshbhx/gavel-auction',
      commit: manifest.commit,
      build_run_url: manifest.build_run_url,
      dataset_versions: versions,
    },
    gates,
    latency: { spans, calls, targets: parseTargets(gatesMd) },
    sim,
    stt,
  };
}

export function main(datasetsDir, outDir) {
  const data = buildExplorer(resolve(datasetsDir));
  const out = resolve(outDir);
  mkdirSync(join(out, 'data'), { recursive: true });
  cpSync(SPACE_SRC, out, { recursive: true, filter: (p) => !p.includes(`${SPACE_SRC}/data`) });
  writeFileSync(join(out, 'data', 'explorer.json'), JSON.stringify(data, null, 2) + '\n');
  process.stdout.write(`space built in ${out}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) {
    process.stderr.write('usage: build-space.mjs DATASETS_DIR OUT_DIR\n');
    process.exitCode = 2;
  } else {
    try {
      main(process.argv[2], process.argv[3]);
    } catch (e) {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = 1;
    }
  }
}
