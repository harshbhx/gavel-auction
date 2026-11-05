import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { amount } from '../../../payments/gates/gateUtil.js';
import { summarize, type MeasuredOp, type Percentiles } from '../../../payments/gates/measure.js';
import { availability, env, newRunId, sleep } from './kit.js';
import { openSession } from './session.js';

// Latency measurement against the real PayPal sandbox (issue 244). Runs N sequential cycles of
// create order, buyer approval, authorize, a partial non-final capture and a void of the rest.
// The buyer approval runs in a browser and is not timed. Each HTTP exchange is timed on its own
// (no retry inside the sample is hidden: a status of 300 or more counts as a failure of that op).
// The output holds numbers only (counts, milliseconds, status counts): no ids, no headers, no
// credentials, no buyer data.
// Run: npm run measure:sandbox -w @gavel/e2e -- --out <dir>   (MEASURE_SANDBOX_CYCLES, default 10)

const DEFAULT_CYCLES = 10;
const CYCLE_CENTS = 2000;
const PARTIAL_CENTS = 1000;
const OPS: readonly MeasuredOp[] = ['order', 'authorize', 'capture', 'void'];

function opOf(step: string): MeasuredOp | undefined {
  if (/create order$/.test(step)) return 'order';
  if (/ authorize$/.test(step)) return 'authorize';
  if (/ capture$/.test(step)) return 'capture';
  if (/ void$/.test(step)) return 'void';
  return undefined;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const out = outIdx >= 0 ? (argv[outIdx + 1] ?? '') : '';
  if (out === '') {
    process.stderr.write('usage: measure-cli --out <dir>\n');
    return 2;
  }
  if (!availability.ok) {
    process.stdout.write(`measure skipped: sandbox secrets missing: ${availability.missing.join(' ')}\n`);
    return 0;
  }
  const raw = Number(env['MEASURE_SANDBOX_CYCLES'] ?? DEFAULT_CYCLES);
  const cycles = Number.isInteger(raw) && raw > 0 && raw <= 50 ? raw : DEFAULT_CYCLES;

  const runId = newRunId('measure');
  const s = await openSession({ env, runId, gate: 'QA-MEASURE', now: () => Date.now(), sleep });
  const samples: Record<MeasuredOp, number[]> = { order: [], authorize: [], capture: [], void: [] };
  const failures: Record<MeasuredOp, number> = { order: 0, authorize: 0, capture: 0, void: 0 };
  const statuses: Record<string, number> = {};
  const inner = s.http.request.bind(s.http);
  s.http.request = async (step, req) => {
    const op = opOf(step);
    const t0 = performance.now();
    const res = await inner(step, req);
    const ms = Math.round((performance.now() - t0) * 100) / 100;
    if (op !== undefined) {
      if (res.status < 300) samples[op].push(ms);
      else failures[op] += 1;
    }
    const key = String(res.status);
    statuses[key] = (statuses[key] ?? 0) + 1;
    return res;
  };

  let completed = 0;
  for (let i = 1; i <= cycles; i += 1) {
    try {
      const a = await s.authorize(`m${i}`, CYCLE_CENTS);
      await s.call(`m${i} capture`, {
        method: 'POST',
        path: `/v2/payments/authorizations/${a.authId}/capture`,
        requestId: `${runId}-m${i}-cap`.slice(0, 60),
        body: { amount: amount(PARTIAL_CENTS), final_capture: false, invoice_id: `${runId}-m${i}` },
      });
      await s.call(`m${i} void`, {
        method: 'POST',
        path: `/v2/payments/authorizations/${a.authId}/void`,
        requestId: `${runId}-m${i}-void`.slice(0, 60),
      });
      completed += 1;
    } catch (e) {
      process.stdout.write(`cycle ${i} failed: ${e instanceof Error ? e.name : 'error'}\n`);
    }
  }

  const ops: Partial<Record<MeasuredOp, Percentiles>> = {};
  for (const op of OPS) ops[op] = summarize(samples[op], failures[op]);
  const lines = [
    '| op | n | failed | p50 ms | p95 ms | max ms |',
    '|----|---|--------|--------|--------|--------|',
  ];
  for (const op of OPS) {
    const p = ops[op] as Percentiles;
    lines.push(`| ${op} | ${p.count} | ${p.failures} | ${p.p50} | ${p.p95} | ${p.max} |`);
  }
  const table = lines.join('\n');
  const report = {
    v: 1,
    runId,
    env: 'sandbox',
    cycles,
    completed,
    ops,
    statusCounts: statuses,
    count429: statuses['429'] ?? 0,
    table,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'measure-sandbox.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, 'measure-sandbox.md'), `${table}\n`);
  process.stdout.write(`${table}\ncycles completed: ${completed} of ${cycles}\n`);
  return completed === cycles ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`measure failed: ${e instanceof Error ? e.name : 'error'}\n`);
    process.exit(1);
  },
);
