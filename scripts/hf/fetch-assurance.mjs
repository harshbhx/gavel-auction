#!/usr/bin/env node
// Aggregates the red-team and audit issues of the repository into counts. No issue title, body or
// author is kept: only numbers per label, severity and area.
// Usage: node scripts/hf/fetch-assurance.mjs OUT_FILE.jsonl
// Env: GITHUB_TOKEN (read access to issues), GITHUB_REPOSITORY (default harshbhx/gavel-auction).
// The query is pinned: every issue (not pull request) that carries at least one of POPULATION_LABELS.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const POPULATION_LABELS = ['red-team', 'audit-r1', 'audit-r2', 'redteam-r4'];
export const SEVERITIES = ['critical', 'high', 'medium', 'low'];

const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};

/** issues: [{number, state, created_at, closed_at, labels:[names]}] -> rows */
export function aggregate(issues, repo, asOf) {
  const q = (labels, extra = [], exclude = []) => {
    const lab = `label:${labels.map((l) => `"${l}"`).join(',')}`;
    const parts = [
      'is:issue',
      lab,
      ...extra.map((l) => `label:"${l}"`),
      ...exclude.map((l) => `-label:"${l}"`),
    ];
    return `https://github.com/${repo}/issues?q=${encodeURIComponent(parts.join(' '))}`;
  };
  const row = (dimension, key, sel, url) => {
    const closed = sel.filter((i) => i.state === 'closed');
    const hours = closed
      .filter((i) => i.closed_at && i.created_at)
      .map((i) => (Date.parse(i.closed_at) - Date.parse(i.created_at)) / 3_600_000);
    return {
      dimension,
      key,
      found: sel.length,
      closed: closed.length,
      open: sel.length - closed.length,
      closed_rate: sel.length === 0 ? 0 : Math.round((closed.length / sel.length) * 1000) / 1000,
      median_hours_to_close: median(hours),
      query_url: url,
      as_of_utc: asOf,
    };
  };
  const has = (i, name) => i.labels.includes(name);
  const rows = [
    row('overall', 'any of ' + POPULATION_LABELS.join(', '), issues, q(POPULATION_LABELS)),
  ];
  for (const l of POPULATION_LABELS)
    rows.push(
      row(
        'label',
        l,
        issues.filter((i) => has(i, l)),
        q([l]),
      ),
    );
  for (const s of SEVERITIES) {
    // Severity is reported for the red-team label, where every finding is rated.
    rows.push(
      row(
        'severity',
        s,
        issues.filter((i) => has(i, 'red-team') && has(i, `severity:${s}`)),
        q(['red-team'], [`severity:${s}`]),
      ),
    );
  }
  // Severity covers the red-team label only; red-team findings without any severity label get their
  // own row so that the severity rows add up to the red-team count (issue 2328).
  rows.push(
    row(
      'severity',
      'unlabelled',
      issues.filter((i) => has(i, 'red-team') && !SEVERITIES.some((s) => has(i, `severity:${s}`))),
      q(
        ['red-team'],
        [],
        SEVERITIES.map((s) => `severity:${s}`),
      ),
    ),
  );
  const areas = [
    ...new Set(issues.flatMap((i) => i.labels.filter((l) => l.startsWith('area:')))),
  ].sort();
  for (const a of areas)
    rows.push(
      row(
        'area',
        a,
        issues.filter((i) => has(i, a)),
        q(POPULATION_LABELS, [a]),
      ),
    );
  // Area labels overlap (an issue can carry several), so area rows can add up to more than the
  // population; the unlabelled row counts the issues that carry no area label at all.
  rows.push(
    row(
      'area',
      'unlabelled',
      issues.filter((i) => !i.labels.some((l) => l.startsWith('area:'))),
      q(POPULATION_LABELS, [], areas),
    ),
  );
  return rows;
}

async function fetchLabel(repo, label, token) {
  const out = [];
  let url = `https://api.github.com/repos/${repo}/issues?state=all&per_page=100&labels=${encodeURIComponent(label)}`;
  while (url !== null) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) throw new Error(`GitHub API answered ${res.status} for label ${label}`);
    for (const i of await res.json()) {
      if (i.pull_request !== undefined) continue;
      out.push({
        number: i.number,
        state: i.state,
        created_at: i.created_at,
        closed_at: i.closed_at,
        labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name)),
      });
    }
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '');
    url = next === null ? null : next[1];
  }
  return out;
}

export async function main(outFile) {
  const token = process.env.GITHUB_TOKEN;
  if (token === undefined || token === '') throw new Error('GITHUB_TOKEN is not set');
  const repo = process.env.GITHUB_REPOSITORY ?? 'harshbhx/gavel-auction';
  const byNumber = new Map();
  for (const l of POPULATION_LABELS)
    for (const i of await fetchLabel(repo, l, token)) byNumber.set(i.number, i);
  const rows = aggregate([...byNumber.values()], repo, new Date().toISOString().slice(0, 10));
  writeFileSync(outFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  process.stdout.write(`assurance: ${byNumber.size} issues aggregated into ${rows.length} rows\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2] ?? '').catch((e) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}
