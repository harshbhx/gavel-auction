#!/usr/bin/env node
// Validates every built dataset against its table schema (scripts/hf/schemas/<dataset>.json, a
// Frictionless-style table schema subset) and runs data-quality checks. Writes
// quality-report.md, quality-report.json and data-dictionary.md into OUT_DIR. Exit 1 on any failure.
// Usage: node scripts/hf/validate-datasets.mjs OUT_DIR
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const readJsonl = (p) =>
  readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));

export function validateRow(row, table) {
  const problems = [];
  const names = Object.keys(table.fields);
  for (const k of Object.keys(row))
    if (!(k in table.fields)) problems.push(`unexpected field ${k}`);
  for (const name of names) {
    const spec = table.fields[name];
    const nullable = spec.endsWith('?');
    const type = nullable ? spec.slice(0, -1) : spec;
    const v = row[name];
    if (v === undefined) {
      problems.push(`missing field ${name}`);
      continue;
    }
    if (v === null) {
      if (!nullable) problems.push(`null in required field ${name}`);
      continue;
    }
    const ok =
      (type === 'string' && typeof v === 'string') ||
      (type === 'integer' && Number.isInteger(v)) ||
      (type === 'number' && typeof v === 'number' && Number.isFinite(v)) ||
      (type === 'boolean' && typeof v === 'boolean') ||
      type === 'json';
    if (!ok) {
      problems.push(`${name} is not ${type}`);
      continue;
    }
    const min = table.min?.[name];
    const max = table.max?.[name];
    if (min !== undefined && v < min) problems.push(`${name} below ${min}`);
    if (max !== undefined && v > max) problems.push(`${name} above ${max}`);
    const en = table.enum?.[name];
    if (en !== undefined && !en.includes(v)) problems.push(`${name} not in enum`);
    const pat = table.pattern?.[name];
    if (pat !== undefined && !new RegExp(pat).test(v))
      problems.push(`${name} does not match its pattern`);
  }
  return problems;
}

class Report {
  constructor() {
    this.results = [];
  }
  check(dataset, name, ok, detail = '') {
    this.results.push({ dataset, name, ok, detail: ok ? '' : detail });
  }
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const within = (a, b, tol) => Math.abs(a - b) <= tol;

const EXTRA = {
  'gavel-sim-30d'(rep, d, t) {
    const lots = t['lots.jsonl'];
    const holds = t['holds.jsonl'];
    if (!lots || !holds) return;
    const bad = (f) =>
      lots
        .filter((r) => !f(r))
        .map((r) => r.lot_id)
        .slice(0, 5)
        .join(',');
    rep.check(
      d,
      'ledger balances per lot: held = captured + released + open',
      lots.every((r) => r.held_cents === r.captured_cents + r.released_cents + r.open_cents),
      `lots ${bad((r) => r.held_cents === r.captured_cents + r.released_cents + r.open_cents)}`,
    );
    rep.check(
      d,
      'ledger balances per hold',
      holds.every((r) => r.ceiling_cents === r.captured_cents + r.released_cents + r.open_cents),
      'a hold does not balance',
    );
    rep.check(
      d,
      'no lost hold: nothing is still open after the expiry sweep',
      lots.every((r) => r.open_cents === 0) && holds.every((r) => r.open_cents === 0),
      'open cents remain',
    );
    rep.check(
      d,
      'a settled lot captured exactly its winning price (or nothing when unsold)',
      lots
        .filter((r) => r.status === 'settled')
        .every((r) => r.captured_cents === (r.winner_cents ?? 0)),
      `lots ${bad((r) => r.status !== 'settled' || r.captured_cents === (r.winner_cents ?? 0))}`,
    );
    rep.check(
      d,
      'holds roll up to their lot (count and cents)',
      lots.every((r) => {
        const hs = holds.filter((h) => h.lot_id === r.lot_id);
        return (
          hs.length === r.holds &&
          sum(hs.map((h) => h.captured_cents)) === r.captured_cents &&
          sum(hs.map((h) => h.ceiling_cents)) === r.held_cents
        );
      }),
      'a lot does not match its holds',
    );
    rep.check(
      d,
      'review_cause is set exactly for lots in review',
      lots.every((r) => (r.status === 'review') === (r.review_cause !== null)),
      'cause and status disagree',
    );
    rep.check(
      d,
      'no capture without a winner',
      lots.every((r) => r.winner_cents !== null || r.captured_cents === 0),
      'captured without a winner',
    );
    rep.check(
      d,
      'every hold belongs to a listed lot',
      holds.every((h) => lots.some((l) => l.lot_id === h.lot_id)),
      'orphan hold',
    );
  },
  'gavel-latency'(rep, d, t) {
    const spans = t['settlement_spans.jsonl'] ?? [];
    const calls = t['api_calls.jsonl'] ?? [];
    rep.check(
      d,
      'span percentiles are ordered: min <= p50 <= p95 <= p99 <= max',
      spans.every(
        (r) =>
          r.min_ms <= r.p50_ms &&
          r.p50_ms <= r.p95_ms &&
          r.p95_ms <= r.p99_ms &&
          r.p99_ms <= r.max_ms,
      ),
      'unordered percentiles',
    );
    rep.check(
      d,
      'call percentiles are ordered: p50 <= p95 <= max',
      calls.every((r) => r.p50_ms <= r.p95_ms && r.p95_ms <= r.max_ms),
      'unordered percentiles',
    );
    rep.check(
      d,
      'settled is never faster than captured in the same run',
      ['pilot', 'main'].every((l) => {
        const c = spans.find((r) => r.run_label === l && r.span === 'hammer_to_captured');
        const s = spans.find((r) => r.run_label === l && r.span === 'hammer_to_settled');
        return c !== undefined && s !== undefined && s.p50_ms >= c.p50_ms;
      }),
      'settled faster than captured',
    );
    rep.check(
      d,
      'failures never exceed n',
      [...spans, ...calls].every((r) => r.failures <= r.n),
      'failures above n',
    );
  },
  'gavel-stt-bids'(rep, d, t, dir) {
    const clips = t['audio/metadata.jsonl'] ?? [];
    const prov = t['provider_outputs.jsonl'] ?? [];
    const scores = t['scores.jsonl'] ?? [];
    rep.check(
      d,
      'every clip has a wav file',
      clips.every((c) => existsSync(join(dir, 'audio', c.file_name))),
      'wav missing',
    );
    rep.check(
      d,
      'every provider row refers to a listed clip',
      prov.every((p) => clips.some((c) => c.id === p.id)),
      'unknown clip id',
    );
    rep.check(
      d,
      'every clip has 4 provider rows (2 providers x 2 clip sets)',
      clips.every((c) => prov.filter((p) => p.id === c.id).length === 4),
      'a clip lacks outputs',
    );
    rep.check(
      d,
      'the human clip set is text only (no audio for it)',
      !readdirSync(dir).some((n) => /human/i.test(n)) && !existsSync(join(dir, 'audio-human')),
      'human audio present',
    );
    rep.check(
      d,
      'a clip expecting a bid has an amount',
      clips.every((c) => c.expected_outcome !== 'bid' || c.expected_amount_cents !== null),
      'bid without amount',
    );
    rep.check(
      d,
      'scores recompute from provider_outputs (mean wer within 0.01)',
      scores.every((s) => {
        const sel = prov.filter((p) => p.clip_set === s.clip_set && p.provider === s.provider);
        return (
          sel.length === s.clips &&
          within(sum(sel.map((p) => p.wer)) / sel.length, s.mean_wer, 0.01)
        );
      }),
      'score mismatch',
    );
  },
  'gavel-audit-demo'(rep, d, t) {
    const ev = t['events.jsonl'] ?? [];
    const out = t['outcomes.jsonl'] ?? [];
    const led = t['ledger_events.jsonl'] ?? [];
    const by = (rows, k) =>
      rows.reduce((m, r) => m.set(r[k], [...(m.get(r[k]) ?? []), r]), new Map());
    rep.check(
      d,
      'timestamps are monotonic within each scenario',
      [...by(ev, 'scenario').values()].every((rs) =>
        rs.every((r, i) => i === 0 || (r.t_ms >= rs[i - 1].t_ms && r.seq > rs[i - 1].seq)),
      ),
      't_ms or seq goes backwards',
    );
    rep.check(
      d,
      'every event scenario has an outcome and the reverse',
      ev.every((e) => out.some((o) => o.scenario === e.scenario)) &&
        out.every((o) => ev.some((e) => e.scenario === o.scenario)),
      'scenario without outcome or events',
    );
    rep.check(
      d,
      'ledger sequence is contiguous from 0 in each scenario',
      [...by(led, 'scenario').values()].every((rs) => rs.every((r, i) => r.seq === i)),
      'gap in ledger seq',
    );
    rep.check(
      d,
      'all ledger invariants held in every scenario',
      out.every((o) => o.invariants_all_hold === true),
      'an invariant failed',
    );
    rep.check(
      d,
      'money is never negative and a winner implies a price',
      out.every(
        (o) =>
          o.captured_cents >= 0 &&
          o.released_cents >= 0 &&
          (o.winner === null) === (o.price_cents === null),
      ),
      'winner and price disagree',
    );
    rep.check(
      d,
      'actors are anonymised (bidder_x or auctioneer)',
      ev.every((e) => e.actor === null || /^(bidder_[a-z]|auctioneer)$/.test(e.actor)),
      'a real-looking actor name',
    );
  },
  'gavel-gates'(rep, d, t) {
    const gates = t['gates.jsonl'] ?? [];
    const files = t['evidence_files.jsonl'] ?? [];
    const as = t['assurance.jsonl'];
    const nightly = t['nightly_results.jsonl'] ?? [];
    rep.check(
      d,
      'gates G0 to G5 are all present once',
      ['G0', 'G1', 'G2', 'G3', 'G4', 'G5'].every(
        (g) => gates.filter((r) => r.gate === g).length === 1,
      ),
      'a gate is missing or duplicated',
    );
    rep.check(
      d,
      'G3 reads IN PROGRESS while the probe runs',
      gates.find((g) => g.gate === 'G3')?.status === 'IN PROGRESS',
      'G3 status',
    );
    rep.check(
      d,
      'every evidence hash equals the one recorded in docs/GATES.md',
      files.every((f) => f.matches_claim !== false),
      'hash differs from the claim',
    );
    rep.check(
      d,
      'nightly reports were finished before they were generated',
      nightly.every((r) => Date.parse(r.finished_at) <= Date.parse(r.generated_at) + 1000),
      'finished after generated',
    );
    if (as !== undefined) {
      rep.check(
        d,
        'assurance: found = closed + open on every row',
        as.every((r) => r.found === r.closed + r.open),
        'counts do not add up',
      );
      const rt = as.find((r) => r.dimension === 'label' && r.key === 'red-team');
      rep.check(
        d,
        'assurance: severity rows add up to at most the red-team count',
        rt !== undefined &&
          sum(as.filter((r) => r.dimension === 'severity').map((r) => r.found)) <= rt.found,
        'severity above total',
      );
      const all = as.find((r) => r.dimension === 'overall');
      rep.check(
        d,
        'assurance: the overall count covers every label',
        all !== undefined &&
          as.filter((r) => r.dimension === 'label').every((r) => r.found <= all.found),
        'label above overall',
      );
    }
  },
};

export function validateDataset(rep, dataset, dir) {
  const schema = JSON.parse(readFileSync(join(HERE, 'schemas', `${dataset}.json`), 'utf8'));
  const loaded = {};
  const readme = existsSync(join(dir, 'README.md'))
    ? readFileSync(join(dir, 'README.md'), 'utf8')
    : '';
  rep.check(
    dataset,
    'dataset card README.md exists with front matter',
    readme.startsWith('---\n'),
    'no card',
  );
  for (const [file, table] of Object.entries(schema.tables)) {
    const path = join(dir, file);
    if (!existsSync(path)) {
      rep.check(dataset, `${file}: present`, table.optional === true, 'file missing');
      continue;
    }
    const rows = readJsonl(path);
    loaded[file] = rows;
    const n = rows.length;
    const want = table.rows ?? {};
    rep.check(
      dataset,
      `${file}: row count ${want.exact !== undefined ? `= ${want.exact}` : `>= ${want.min ?? 0}`}`,
      want.exact !== undefined ? n === want.exact : n >= (want.min ?? 0),
      `got ${n}`,
    );
    const problems = rows.flatMap((r, i) => validateRow(r, table).map((p) => `row ${i + 1}: ${p}`));
    rep.check(
      dataset,
      `${file}: every row matches the schema (types, nulls, ranges, enums)`,
      problems.length === 0,
      problems.slice(0, 3).join('; '),
    );
    if ((table.primaryKey ?? []).length > 0) {
      const keys = rows.map((r) => table.primaryKey.map((k) => r[k]).join('\u0001'));
      rep.check(
        dataset,
        `${file}: primary key (${table.primaryKey.join(', ')}) is unique`,
        new Set(keys).size === keys.length,
        'duplicate key',
      );
    }
    rep.check(
      dataset,
      `${file}: no duplicate rows`,
      new Set(rows.map((r) => JSON.stringify(r))).size === n,
      'duplicate row',
    );
    const documented = Object.keys(table.fields).filter((f) => !readme.includes(f));
    rep.check(
      dataset,
      `${file}: every field is documented in the card`,
      documented.length === 0,
      documented.join(', '),
    );
    const csv = join(dir, file.replace(/\.jsonl$/, '.csv'));
    if (file !== 'audio/metadata.jsonl') {
      const lines = existsSync(csv)
        ? readFileSync(csv, 'utf8')
            .split('\n')
            .filter((l) => l !== '').length
        : -1;
      // quoted newlines would break a line count, so this is a lower bound check
      rep.check(
        dataset,
        `${file}: the csv twin exists and is not shorter`,
        lines >= n + 1,
        `csv lines ${lines}`,
      );
    }
  }
  EXTRA[dataset]?.(rep, dataset, loaded, dir);
  return schema;
}

export function dictionary(schemas) {
  const out = [
    '# Data dictionary',
    '',
    'Generated from `scripts/hf/schemas`. A trailing `?` means the field may be null.',
    '',
  ];
  for (const s of schemas) {
    out.push(`## ${s.dataset} (version ${s.version})`, '');
    for (const [file, t] of Object.entries(s.tables)) {
      out.push(
        `### ${file}`,
        '',
        `Source: ${t.source}`,
        '',
        '| Field | Type | Constraints |',
        '| --- | --- | --- |',
      );
      for (const [f, ty] of Object.entries(t.fields)) {
        const c = [];
        if (t.primaryKey?.includes(f)) c.push('key');
        if (t.min?.[f] !== undefined) c.push(`min ${t.min[f]}`);
        if (t.max?.[f] !== undefined) c.push(`max ${t.max[f]}`);
        if (t.enum?.[f] !== undefined) c.push(`one of ${t.enum[f].join(', ')}`);
        if (t.pattern?.[f] !== undefined) c.push(`pattern ${t.pattern[f]}`);
        if (f.endsWith('_cents')) c.push('integer cents');
        out.push(`| \`${f}\` | ${ty} | ${c.join('; ')} |`);
      }
      out.push('');
    }
  }
  return out.join('\n') + '\n';
}

export function main(outArg) {
  const out = resolve(outArg);
  const rep = new Report();
  const schemas = [];
  const names = readdirSync(out)
    .filter((n) => statSync(join(out, n)).isDirectory())
    .sort();
  for (const name of names) schemas.push(validateDataset(rep, name, join(out, name)));
  const failed = rep.results.filter((r) => !r.ok);
  const md = [
    '# Data-quality report',
    '',
    `Datasets: ${names.join(', ')}. Checks: ${rep.results.length}, failed: ${failed.length}.`,
    '',
  ];
  for (const name of names) {
    const rs = rep.results.filter((r) => r.dataset === name);
    md.push(
      `## ${name}`,
      '',
      `${rs.filter((r) => r.ok).length} of ${rs.length} checks passed.`,
      '',
      '| Check | Result | Detail |',
      '| --- | --- | --- |',
    );
    for (const r of rs)
      md.push(
        `| ${r.name.replace(/\|/g, '/')} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.detail.replace(/\|/g, '/')} |`,
      );
    md.push('');
  }
  writeFileSync(join(out, 'quality-report.md'), md.join('\n') + '\n');
  writeFileSync(
    join(out, 'quality-report.json'),
    JSON.stringify(
      { checks: rep.results.length, failed: failed.length, results: rep.results },
      null,
      2,
    ) + '\n',
  );
  writeFileSync(join(out, 'data-dictionary.md'), dictionary(schemas));
  process.stdout.write(
    `quality: ${rep.results.length - failed.length}/${rep.results.length} checks passed\n`,
  );
  for (const f of failed) process.stderr.write(`FAIL ${f.dataset}: ${f.name} (${f.detail})\n`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = process.argv.length === 3 ? main(process.argv[2]) : 2;
}
