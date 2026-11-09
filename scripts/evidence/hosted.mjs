// Evidence about the hosted API (issue 2191): warmup time after idle, the webhook route's answer
// time with an ignored event type (no verify call, read-only on the host), and the recent runs of
// the existing judge smoke (which walks the judge room with the simulated hold).
// Commands (each prints one JSON line; `report` writes the evidence files):
//   node scripts/evidence/hosted.mjs probe   --api <origin> --label <text> --out <samples.json>
//   node scripts/evidence/hosted.mjs webhook --api <origin> --n <1..100> --out <webhook.json>
//   node scripts/evidence/hosted.mjs judge   --repo <owner/name> --out <judge.json>
//   node scripts/evidence/hosted.mjs report  --dir <dir> --out <dir> [--run-url <url>] [--idle-minutes N]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  mdTable,
  parseFlags,
  readJsonIfPresent,
  summarize,
  verdictLine,
  writeEvidence,
} from './lib.mjs';

export const WARMUP_BUDGET_MS = 3000;
export const WEBHOOK_TARGET_MS = 300;
export const IGNORED_EVENT_TYPE = 'CHECKOUT.ORDER.APPROVED';
const MIN_WEBHOOK_N = 20;

/** Only an https origin (or a loopback http one for tests) is accepted, with no path. */
export function checkOrigin(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('--api must be an origin URL');
  }
  const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (!(u.protocol === 'https:' || (loopback && u.protocol === 'http:')) || u.pathname !== '/') {
    throw new Error('--api must be an https origin with no path');
  }
  return u.origin;
}

async function timed(url, init) {
  const t0 = performance.now();
  let status = 0;
  let error = '';
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    await res.arrayBuffer();
    status = res.status;
  } catch (e) {
    error = e instanceof Error ? e.name : 'error';
  }
  return { status, ms: Math.round((performance.now() - t0) * 100) / 100, error };
}

/** One /warmup and one /healthz timing from a fresh process (new connection, DNS and TLS included). */
export async function probeOnce(api, label) {
  const out = [];
  for (const path of ['/warmup', '/healthz']) {
    out.push({ label, path, ...(await timed(`${api}${path}`, { method: 'GET' })) });
  }
  return out;
}

/** n sequential POSTs of an ignored event type to the webhook route. */
export async function webhookProbe(api, n) {
  const samples = [];
  const statusCounts = {};
  for (let i = 0; i < n; i += 1) {
    const r = await timed(`${api}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: `WH-EVIDENCE-${i}`,
        event_type: IGNORED_EVENT_TYPE,
        resource: { id: `EVIDENCE-${i}` },
      }),
    });
    statusCounts[String(r.status)] = (statusCounts[String(r.status)] ?? 0) + 1;
    if (r.status === 200) samples.push(r.ms);
  }
  return { n, statusCounts, samples };
}

/** Compact summary of `gh run list` JSON for the judge smoke workflow. */
export function summarizeJudgeRuns(runs) {
  const rows = runs.map((r) => ({
    url: r.url,
    event: r.event,
    conclusion: r.conclusion,
    createdAt: r.createdAt,
    durationSec: Math.max(
      0,
      Math.round((Date.parse(r.updatedAt) - Date.parse(r.createdAt)) / 1000),
    ),
  }));
  const done = rows.filter((r) => r.conclusion !== '' && r.conclusion !== null);
  return {
    listed: rows.length,
    success: done.filter((r) => r.conclusion === 'success').length,
    failure: done.filter((r) => r.conclusion !== 'success').length,
    runs: rows,
  };
}

/** The step list of one run's job with conclusions and seconds, for the journey step. */
export function summarizeJudgeSteps(job) {
  return (job?.steps ?? []).map((s) => ({
    name: s.name,
    conclusion: s.conclusion,
    seconds:
      Math.max(0, Math.round((Date.parse(s.completedAt) - Date.parse(s.startedAt)) / 1000)) || 0,
  }));
}

/** Builds the evidence object from the parts (each may be undefined). */
export function buildHostedEvidence({ samples, webhook, judge, runUrl = '', idleMinutes }) {
  const problems = [];
  const out = { v: 1, kind: 'hosted-evidence', runUrl, problems };

  if (samples === undefined || samples.length === 0) problems.push('no warmup samples');
  else {
    const part = (path) => {
      const ok = samples.filter((s) => s.path === path && s.status === 200).map((s) => s.ms);
      const failed = samples.filter((s) => s.path === path && s.status !== 200).length;
      return { ...summarize(ok), failed };
    };
    const warm = part('/warmup');
    const health = part('/healthz');
    out.warmupAfterIdle = {
      idleMinutes: idleMinutes ?? null,
      budgetMs: WARMUP_BUDGET_MS,
      warmup: warm,
      healthz: health,
      status: warm.count === 0 ? 'NO DATA' : warm.max <= WARMUP_BUDGET_MS ? 'MET' : 'MISSED',
      note: 'Each sample is a fresh process with a new connection. The host may never go cold; if every sample is fast, that is the finding. The scheduled uptime workflow can also keep it warm.',
    };
    if (warm.failed > 0) problems.push(`${warm.failed} /warmup probes did not answer 200`);
    if (warm.count === 0) problems.push('no successful /warmup sample');
  }

  if (webhook === undefined) problems.push('no webhook samples');
  else {
    const s = summarize(webhook.samples);
    const bad = Object.entries(webhook.statusCounts).some(([k, c]) => k !== '200' && c > 0);
    out.webhookHandler = {
      label:
        'hosted API, client on a GitHub runner, network included; the event type is ignored so no verify call is made and nothing is stored',
      n: webhook.n,
      statusCounts: webhook.statusCounts,
      ...s,
      targetMs: WEBHOOK_TARGET_MS,
      status: bad || s.count === 0 ? 'INVALID' : s.p95 <= WEBHOOK_TARGET_MS ? 'MET' : 'MISSED',
    };
    if (webhook.n < MIN_WEBHOOK_N)
      problems.push(`webhook n=${webhook.n} is below ${MIN_WEBHOOK_N}`);
    if (bad) problems.push('webhook route answered something other than 200');
  }

  if (judge === undefined) problems.push('judge smoke runs not read');
  else {
    out.judgeSmoke = judge;
    if (judge.listed === 0) problems.push('no judge smoke runs found');
  }
  out.verdict = problems.length === 0 ? 'RECORDED' : 'INCOMPLETE';
  return out;
}

export function renderHostedMarkdown(ev) {
  const L = [`# Hosted API evidence: ${ev.verdict}`, ''];
  if (ev.runUrl !== '') L.push(`Run: ${ev.runUrl}`, '');
  const w = ev.warmupAfterIdle;
  if (w !== undefined) {
    L.push(
      `## Warmup after idle (${w.idleMinutes ?? '?'} min sleep before each sample), budget ${w.budgetMs} ms: ${w.status}`,
      '',
    );
    L.push(
      mdTable(
        ['route', 'n', 'failed', 'p50 ms', 'max ms'],
        [
          ['/warmup', w.warmup.count, w.warmup.failed, w.warmup.p50, w.warmup.max],
          ['/healthz', w.healthz.count, w.healthz.failed, w.healthz.p50, w.healthz.max],
        ],
      ),
      '',
      w.note,
      '',
    );
  }
  const h = ev.webhookHandler;
  if (h !== undefined) {
    L.push(
      `## Webhook handler, no verify call (target ${h.targetMs} ms p95): ${h.status}`,
      '',
      h.label,
      '',
    );
    L.push(
      mdTable(
        ['n', 'p50 ms', 'p95 ms', 'p99 ms', 'max ms'],
        [[h.count, h.p50, h.p95, h.p99, h.max]],
      ),
      '',
    );
  }
  const j = ev.judgeSmoke;
  if (j !== undefined) {
    L.push(
      `## Judge smoke (simulated hold path), last ${j.listed} runs: ${j.success} success, ${j.failure} not`,
      '',
    );
    L.push(
      mdTable(
        ['run', 'event', 'conclusion', 'seconds'],
        j.runs.map((r) => [r.url, r.event, r.conclusion, r.durationSec]),
      ),
      '',
    );
    if (j.latestSteps?.length) {
      L.push(
        'Latest run steps:',
        '',
        mdTable(
          ['step', 'conclusion', 'seconds'],
          j.latestSteps.map((s) => [s.name, s.conclusion, s.seconds]),
        ),
        '',
      );
    }
  }
  if (ev.problems.length > 0) L.push('## Problems', '', ...ev.problems.map((p) => `- ${p}`), '');
  return L.join('\n');
}

export function hostedVerdictLine(ev) {
  const parts = [];
  const w = ev.warmupAfterIdle;
  if (w)
    parts.push(`warmup max ${w.warmup.max} ms vs ${w.budgetMs}: ${w.status}, n=${w.warmup.count}`);
  const h = ev.webhookHandler;
  if (h) parts.push(`webhook p95 ${h.p95} ms vs ${h.targetMs}: ${h.status}, n=${h.count}`);
  const j = ev.judgeSmoke;
  if (j) parts.push(`judge smoke ${j.success}/${j.listed} success`);
  if (ev.problems.length > 0) parts.push(`${ev.problems.length} problem(s)`);
  return verdictLine('HOSTED EVIDENCE', ev.verdict, parts.join('; '));
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const f = parseFlags(rest);
  if (cmd === 'probe') {
    const api = checkOrigin(f.api);
    const samples = await probeOnce(api, f.label ?? 'sample');
    let all = readJsonIfPresent(f.out) ?? [];
    all = all.concat(samples);
    writeFileSync(f.out, `${JSON.stringify(all, null, 2)}\n`);
    console.log(JSON.stringify(samples));
    return 0;
  }
  if (cmd === 'webhook') {
    const api = checkOrigin(f.api);
    const n = Number(f.n);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error('--n must be 1 to 100');
    const r = await webhookProbe(api, n);
    writeFileSync(f.out, `${JSON.stringify(r, null, 2)}\n`);
    console.log(JSON.stringify({ n: r.n, statusCounts: r.statusCounts }));
    return 0;
  }
  if (cmd === 'judge') {
    const runs = JSON.parse(
      gh([
        'run',
        'list',
        '-R',
        f.repo,
        '--workflow',
        'judge-smoke.yml',
        '--limit',
        '10',
        '--json',
        'url,event,conclusion,createdAt,updatedAt,databaseId,status',
      ]),
    );
    const finished = runs.filter((r) => r.status === 'completed');
    const summary = summarizeJudgeRuns(finished);
    if (finished[0] !== undefined) {
      const view = JSON.parse(
        gh(['run', 'view', String(finished[0].databaseId), '-R', f.repo, '--json', 'jobs']),
      );
      summary.latestSteps = summarizeJudgeSteps(view.jobs?.[0]);
    }
    writeFileSync(f.out, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({ listed: summary.listed, success: summary.success }));
    return 0;
  }
  if (cmd === 'report') {
    const samples = readJsonIfPresent(join(f.dir, 'warmup-samples.json'));
    const webhook = readJsonIfPresent(join(f.dir, 'webhook.json'));
    const judge = readJsonIfPresent(join(f.dir, 'judge.json'));
    const idle = f['idle-minutes'] === undefined ? undefined : Number(f['idle-minutes']);
    const ev = buildHostedEvidence({
      samples,
      webhook,
      judge,
      runUrl: f['run-url'] ?? '',
      idleMinutes: idle,
    });
    const md = renderHostedMarkdown(ev);
    writeEvidence(f.out, 'hosted-evidence', ev, md);
    console.log(md);
    console.log(hostedVerdictLine(ev));
    return ev.verdict === 'RECORDED' ? 0 : 1;
  }
  console.error('usage: hosted.mjs probe|webhook|judge|report ...');
  return 2;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (c) => {
      process.exitCode = c;
    },
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    },
  );
}
