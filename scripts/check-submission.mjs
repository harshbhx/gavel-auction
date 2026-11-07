#!/usr/bin/env node
// Submit gate (issue 324): read-only checks to run before submitting. Needs Node 22 only, no secrets.
// Usage: node scripts/check-submission.mjs [--strict-devpost] [--summary <file>] [--offline]
//          [--repo owner/name] [--web <url>] [--docs <url>] [--api <url>] [--timeout-ms <n>]
// Checks: repo is public, license detected, README links answer 200, web, docs and API health
// answer 200 (the API may cold start: 60 s per try, 3 tries), docs/SUBMISSION.md has no unchecked
// row without a waiver, no tracked .env or key files, the gitleaks-history workflow is green on
// main, the deployed API /version sha is an ancestor of main, and docs/submission/DEVPOST.md has
// no OWNER: fields left (listed; fails only with --strict-devpost).
// The GitHub API is called without credentials; GITHUB_TOKEN, when present, is only used to raise
// the rate limit. --offline skips every network check and is meant for local trial runs.
// The report is printed and also written to --summary or to $GITHUB_STEP_SUMMARY.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULTS = {
  repo: 'harshbhx/gavel-auction',
  web: 'https://gavel-web.creharsh.workers.dev',
  docs: 'https://gavel-docs.creharsh.workers.dev',
  api: 'https://gavel-auction-aufz.onrender.com',
  timeoutMs: 60_000,
};

// ---- pure helpers (unit tested) ----

/** Rows of the SUBMISSION.md table that are still [ ] and carry no waiver. */
export function parseChecklist(markdown) {
  const rows = [];
  markdown.split('\n').forEach((line, i) => {
    const m = /^\|\s*\[( |x|X)\]\s*\|\s*([^|]+?)\s*\|(.*)$/.exec(line);
    if (!m) return;
    const done = m[1].toLowerCase() === 'x';
    const waived = /\bwaiv(?:ed|er)\b/i.test(m[3]);
    rows.push({ line: i + 1, item: m[2], done, waived });
  });
  return rows;
}

export function openChecklistRows(rows) {
  return rows.filter((r) => !r.done && !r.waived);
}

/** Lines of the Devpost draft that still hold an OWNER: field. */
export function findOwnerFields(markdown) {
  const out = [];
  markdown.split('\n').forEach((line, i) => {
    if (/\bOWNER:/.test(line))
      out.push({ line: i + 1, text: line.replace(/\s+/g, ' ').trim().slice(0, 120) });
  });
  return out;
}

const SKIP_HOST = /(^|\.)(localhost|example\.(com|org|net)|invalid)$|^127\.|^0\.0\.0\.0$/;

/** http(s) links of a Markdown or HTML text, de-duplicated, without placeholders and local hosts. */
export function extractLinks(text) {
  const found = new Set();
  const re = /https?:\/\/[^\s<>"'`)\]]+/g;
  for (const m of text.matchAll(re)) {
    const url = m[0].replace(/[.,;:!]+$/, '');
    if (url.includes('{') || url.includes('$') || url.includes('<') || url.includes('...'))
      continue;
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    if (SKIP_HOST.test(host)) continue;
    found.add(url);
  }
  return [...found].sort();
}

const SECRET_NAME = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$|sample$|template$)[^/]+$/,
  /\.(pem|key|p12|pfx|jks|keystore|ppk)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /(^|\/)(credentials|service-account[^/]*|secrets?)\.json$/i,
];

/** An .npmrc that holds a literal auth value (a reference such as ${NPM_TOKEN} is fine). */
export function npmrcHasToken(text) {
  return /_auth(?:Token)?\s*=\s*(?!\$\{)\S+/i.test(text);
}

/** Tracked files whose name looks like an environment or key file. Public keys and test keys named .pub are kept. */
export function suspiciousFiles(files) {
  return files.filter((f) => !/\.pub$/.test(f) && SECRET_NAME.some((re) => re.test(f)));
}

/** compare/{deployed}...main: deployed is an ancestor of main when main is ahead or identical. */
export function ancestorVerdict(compare) {
  if (compare.status === 'identical') return { ok: true, detail: 'deployed sha is main' };
  if (compare.status === 'ahead')
    return { ok: true, detail: `main is ${compare.ahead_by} commit(s) ahead of the deployed sha` };
  return {
    ok: false,
    detail: `deployed sha is not an ancestor of main (status ${compare.status})`,
  };
}

export function renderSummary(results) {
  const fails = results.filter((r) => r.status === 'FAIL').length;
  const warns = results.filter((r) => r.status === 'WARN').length;
  const lines = [
    `## Submit gate: ${fails === 0 ? 'READY' : 'NOT READY'}`,
    '',
    `${results.length} checks, ${fails} failed, ${warns} warning(s).`,
    '',
    '| Check | Result | Detail |',
    '| --- | --- | --- |',
  ];
  for (const r of results)
    lines.push(`| ${r.name} | ${r.status} | ${r.detail.replace(/\|/g, '/').replace(/\n/g, ' ')} |`);
  for (const r of results) {
    if (r.list && r.list.length > 0) {
      lines.push('', `### ${r.name}`, '');
      for (const item of r.list) lines.push(`- ${item}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

// ---- network helpers ----

async function timedFetch(url, ms, init = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { redirect: 'follow', ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function getStatus(url, { ms, tries }) {
  let last = 'no answer';
  for (let i = 1; i <= tries; i += 1) {
    try {
      const res = await timedFetch(url, ms, { headers: { 'user-agent': 'gavel-submit-gate' } });
      await res.arrayBuffer().catch(() => undefined);
      if (res.status === 200) return { ok: true, status: 200, tries: i };
      last = `HTTP ${res.status}`;
    } catch (e) {
      last =
        e instanceof Error && e.name === 'AbortError' ? `timeout after ${ms} ms` : 'network error';
    }
    if (i < tries) await new Promise((r) => setTimeout(r, 2000));
  }
  return { ok: false, status: last, tries };
}

function ghHeaders() {
  const h = { accept: 'application/vnd.github+json', 'user-agent': 'gavel-submit-gate' };
  if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function ghJson(path) {
  const res = await timedFetch(`https://api.github.com${path}`, 30_000, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`GitHub API ${path} answered ${res.status}`);
  return res.json();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next;
        next += 1;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// ---- checks ----

const pass = (name, detail, extra = {}) => ({ name, status: 'PASS', detail, ...extra });
const fail = (name, detail, extra = {}) => ({ name, status: 'FAIL', detail, ...extra });
const warn = (name, detail, extra = {}) => ({ name, status: 'WARN', detail, ...extra });
const skip = (name) => warn(name, 'skipped (--offline)');

function readRepoFile(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
}

async function checkRepo(opts) {
  if (opts.offline) return [skip('Repo is public'), skip('License detected')];
  try {
    const repo = await ghJson(`/repos/${opts.repo}`);
    return [
      repo.private === false && repo.visibility !== 'private'
        ? pass('Repo is public', `${opts.repo} is public`)
        : fail('Repo is public', `${opts.repo} is not public`),
      repo.license && repo.license.spdx_id && repo.license.spdx_id !== 'NOASSERTION'
        ? pass('License detected', `GitHub detects ${repo.license.spdx_id}`)
        : fail('License detected', 'GitHub does not detect a license for the repository'),
    ];
  } catch (e) {
    return [fail('Repo is public', e.message), fail('License detected', e.message)];
  }
}

async function checkReadmeLinks(opts) {
  const name = 'README links answer 200';
  if (opts.offline) return skip(name);
  const readme = readRepoFile('README.md');
  if (!readme) return fail(name, 'README.md not found');
  const links = extractLinks(readme);
  const results = await mapLimit(links, 6, async (u) => ({
    u,
    r: await getStatus(u, { ms: 20_000, tries: 2 }),
  }));
  const bad = results.filter((x) => !x.r.ok);
  const list = bad.map((x) => `${x.u} (${x.r.status})`);
  return bad.length === 0
    ? pass(name, `${links.length} links checked`)
    : fail(name, `${bad.length} of ${links.length} links did not answer 200`, { list });
}

async function checkUrl(label, url, path, opts, tries) {
  const name = `${label} answers 200`;
  if (opts.offline) return skip(name);
  const r = await getStatus(`${url}${path}`, { ms: opts.timeoutMs, tries });
  return r.ok
    ? pass(name, `${url}${path} (try ${r.tries})`)
    : fail(name, `${url}${path}: ${r.status} after ${r.tries} tries`);
}

function checkChecklist() {
  const name = 'SUBMISSION.md has no open row';
  const text = readRepoFile('docs/SUBMISSION.md');
  if (!text) return fail(name, 'docs/SUBMISSION.md not found');
  const rows = parseChecklist(text);
  if (rows.length === 0) return fail(name, 'no checklist rows found');
  const open = openChecklistRows(rows);
  return open.length === 0
    ? pass(name, `${rows.length} rows, all done or waived`)
    : fail(name, `${open.length} of ${rows.length} rows are still [ ] without a waiver`, {
        list: open.map((r) => `line ${r.line}: ${r.item}`),
      });
}

function checkTrackedSecrets() {
  const name = 'No tracked .env or key files';
  try {
    const files = execFileSync('git', ['ls-files', '-z'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\0')
      .filter(Boolean);
    const bad = suspiciousFiles(files);
    for (const f of files.filter((x) => /(^|\/)\.npmrc$/.test(x))) {
      const text = readRepoFile(f);
      if (text && npmrcHasToken(text)) bad.push(`${f} (holds an auth value)`);
    }
    return bad.length === 0
      ? pass(name, `${files.length} tracked files scanned by name`)
      : fail(name, `${bad.length} suspicious file name(s)`, { list: bad });
  } catch {
    return warn(name, 'not a git checkout, skipped');
  }
}

async function checkGitleaks(opts) {
  const name = 'gitleaks-history green on main';
  if (opts.offline) return skip(name);
  try {
    const data = await ghJson(
      `/repos/${opts.repo}/actions/workflows/gitleaks-history.yml/runs?branch=main&status=completed&per_page=1`,
    );
    const run = data.workflow_runs && data.workflow_runs[0];
    if (!run) return fail(name, 'no completed gitleaks-history run on main');
    return run.conclusion === 'success'
      ? pass(name, `${run.html_url} (${run.head_sha.slice(0, 8)})`)
      : fail(name, `last run concluded ${run.conclusion}: ${run.html_url}`);
  } catch (e) {
    return fail(name, e.message);
  }
}

async function checkVersion(opts) {
  const name = 'Deployed API sha is an ancestor of main';
  if (opts.offline) return skip(name);
  let sha;
  for (let i = 1; i <= 3 && !sha; i += 1) {
    try {
      const res = await timedFetch(`${opts.api}/version`, opts.timeoutMs, {
        headers: { 'user-agent': 'gavel-submit-gate' },
      });
      if (res.ok) sha = (await res.json()).sha;
    } catch {
      // retry
    }
  }
  if (!sha || !/^[0-9a-f]{7,40}$/.test(sha))
    return fail(name, `${opts.api}/version gave no usable sha`);
  try {
    const v = ancestorVerdict(await ghJson(`/repos/${opts.repo}/compare/${sha}...main`));
    return v.ok
      ? pass(name, `${sha.slice(0, 8)}: ${v.detail}`)
      : fail(name, `${sha.slice(0, 8)}: ${v.detail}`);
  } catch (e) {
    return fail(name, `${sha.slice(0, 8)}: ${e.message}`);
  }
}

function checkDevpost(opts) {
  const name = 'Devpost draft has no OWNER fields';
  const text = readRepoFile('docs/submission/DEVPOST.md');
  if (!text) return fail(name, 'docs/submission/DEVPOST.md not found');
  const owner = findOwnerFields(text);
  if (owner.length === 0) return pass(name, 'no OWNER: field left');
  const list = owner.map((o) => `line ${o.line}: ${o.text}`);
  const detail = `${owner.length} OWNER field(s) are empty`;
  return opts.strictDevpost
    ? fail(name, detail, { list })
    : warn(name, `${detail} (fails only with --strict-devpost)`, { list });
}

// ---- main ----

export function parseArgs(argv) {
  const opts = { ...DEFAULTS, offline: false, strictDevpost: false, summary: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${a} needs a value`);
      return argv[i];
    };
    if (a === '--offline') opts.offline = true;
    else if (a === '--strict-devpost') opts.strictDevpost = true;
    else if (a === '--summary') opts.summary = val();
    else if (a === '--repo') opts.repo = val();
    else if (a === '--web') opts.web = val().replace(/\/$/, '');
    else if (a === '--docs') opts.docs = val().replace(/\/$/, '');
    else if (a === '--api') opts.api = val().replace(/\/$/, '');
    else if (a === '--timeout-ms') opts.timeoutMs = Number(val());
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const results = [
    ...(await checkRepo(opts)),
    await checkReadmeLinks(opts),
    await checkUrl('Web app', opts.web, '/', opts, 2),
    await checkUrl('Docs site', opts.docs, '/', opts, 2),
    await checkUrl('API health', opts.api, '/healthz', opts, 3),
    checkChecklist(),
    checkTrackedSecrets(),
    await checkGitleaks(opts),
    await checkVersion(opts),
    checkDevpost(opts),
  ];
  for (const r of results) {
    console.log(`${r.status.padEnd(4)} ${r.name}: ${r.detail}`);
    for (const item of r.list ?? []) console.log(`       - ${item}`);
  }
  const summary = renderSummary(results);
  const target = opts.summary ?? process.env.GITHUB_STEP_SUMMARY;
  if (target) appendFileSync(target, summary);
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(
    failed === 0 ? '\nSubmit gate: READY' : `\nSubmit gate: NOT READY (${failed} failed)`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  });
}
