import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { FakePayPalServer } from '../src/fake/server.js';
import { fetchAccessToken } from './http.js';
import { gateCurrency } from './gateUtil.js';
import {
  EXIT_REFUSED,
  GateUsageError,
  parseGateArgs,
  runGate,
  type GateContext,
  type Json,
} from './runner.js';

/**
 * Rate-limit and latency measurement (SPEC 3.12, R-PAY-147).
 *
 * Runs authorize / capture / void cycles against the sandbox (or, with --fake,
 * against the fake PayPal server that this script starts on a loopback port):
 *
 *   - SEQUENTIAL_CYCLES cycles one after the other (default 50)
 *   - PARALLEL_CYCLES cycles at the same time (default 10)
 *
 * One cycle is: create order (prepared up front), buyer approval, authorize,
 * a partial non-final capture, void of the rest. Per phase and operation the
 * report holds count, failures and the p50 / p95 / p99 latency in milliseconds,
 * plus the number of 429 answers with every Retry-After value seen. The report is
 * written to <out>/measure/<runId>.json and a Markdown table is printed; the
 * table is appended to docs/GATES.md by the summary step (PAY-63).
 *
 * Approval: with --fake the script approves orders itself. In the sandbox a
 * buyer has to approve every order, so the run pauses once after the orders are
 * created (exit code 3); approve every link listed in the evidence file, then
 * rerun with --resume <run file>. UNVERIFIED (G1/M): how many orders a buyer
 * session can approve in practice. Fallback: lower the counts with the
 * MEASURE_SEQUENTIAL and MEASURE_PARALLEL environment variables.
 *
 * Latency is the wall time of one HTTP exchange as seen by this script
 * (performance.now), rounded to 0.01 ms. No retries: a 429 or 5xx fails the
 * cycle and is counted, because retrying would hide what is being measured.
 */

export const MEASURE_SCRIPT_VERSION = 'measure-1';
export const DEFAULT_SEQUENTIAL_CYCLES = 50;
export const DEFAULT_PARALLEL_CYCLES = 10;

export const MEASURED_OPS = ['order', 'authorize', 'capture', 'void'] as const;
export type MeasuredOp = (typeof MEASURED_OPS)[number];

const percentilesSchema = z
  .object({
    count: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    min: z.number().nonnegative(),
    p50: z.number().nonnegative(),
    p95: z.number().nonnegative(),
    p99: z.number().nonnegative(),
    max: z.number().nonnegative(),
  })
  .refine((p) => p.min <= p.p50 && p.p50 <= p.p95 && p.p95 <= p.p99 && p.p99 <= p.max, {
    message: 'percentiles must satisfy min <= p50 <= p95 <= p99 <= max',
  });
export type Percentiles = z.infer<typeof percentilesSchema>;

const phaseSchema = z.object({
  cycles: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  concurrency: z.number().int().positive(),
  ops: z.record(z.enum(MEASURED_OPS), percentilesSchema),
});
export type PhaseReport = z.infer<typeof phaseSchema>;

/** Output of one measurement run (docs/evidence/measure/<runId>.json). */
export const MeasureReport = z.object({
  v: z.literal(1),
  runId: z.string().min(1),
  fake: z.boolean(),
  scriptVersion: z.string().min(1),
  startedAtMs: z.number().int().nonnegative(),
  sequential: phaseSchema,
  parallel: phaseSchema,
  rateLimit: z.object({
    count429: z.number().int().nonnegative(),
    /** Retry-After header values as sent, in order of arrival. */
    retryAfter: z.array(z.string()),
  }),
  table: z.string().min(1),
});
export type MeasureReport = z.infer<typeof MeasureReport>;

// ---------- pure helpers

/** Nearest-rank percentile of a sorted ascending list; p in (0, 100]. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] ?? 0;
}

export function summarize(samples: readonly number[], failures: number): Percentiles {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    failures,
    min: sorted[0] ?? 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function round2(ms: number): number {
  return Math.round(ms * 100) / 100;
}

/** Markdown table of both phases, one row per phase and operation. */
export function renderTable(
  sequential: PhaseReport,
  parallel: PhaseReport,
  rate: { count429: number; retryAfter: readonly string[] },
): string {
  const lines = [
    '| phase | op | n | failed | p50 ms | p95 ms | p99 ms | max ms |',
    '|-------|----|---|--------|--------|--------|--------|--------|',
  ];
  const phases: Array<[string, PhaseReport]> = [
    ['sequential', sequential],
    ['parallel', parallel],
  ];
  for (const [name, phase] of phases) {
    for (const op of MEASURED_OPS) {
      const p = phase.ops[op];
      if (p === undefined) continue;
      lines.push(
        `| ${name} | ${op} | ${p.count} | ${p.failures} | ${p.p50} | ${p.p95} | ${p.p99} | ${p.max} |`,
      );
    }
  }
  const seen = rate.retryAfter.length === 0 ? 'none' : rate.retryAfter.join(', ');
  lines.push('', `429 answers: ${rate.count429}. Retry-After values: ${seen}.`);
  return lines.join('\n');
}

// ---------- measurement

interface Sample {
  op: MeasuredOp;
  ms: number;
  ok: boolean;
}

interface RateLog {
  count429: number;
  retryAfter: string[];
}

interface PreparedOrder {
  orderId: string;
  approveUrl: string;
}

function envCount(env: Record<string, string | undefined>, name: string, dflt: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return dflt;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 1000) {
    throw new GateUsageError(`${name} must be an integer from 1 to 1000`);
  }
  return Number(raw);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function approveLink(json: unknown): string {
  if (!isRecord(json) || !Array.isArray(json['links'])) return '';
  for (const l of json['links']) {
    if (isRecord(l) && l['rel'] === 'approve' && typeof l['href'] === 'string') return l['href'];
  }
  return '';
}

export interface MeasureDeps {
  /** Fake runs only: approves an order the way the buyer would. */
  approveOrder?: (orderId: string) => void;
  env: Record<string, string | undefined>;
  /** Wall clock in ms with sub-ms resolution. Default performance.now. */
  timer?: () => number;
}

/** Gate body: prepare orders, approve, run both phases, write the report. */
export async function measureGate(ctx: GateContext, deps: MeasureDeps): Promise<void> {
  const sequentialCycles = envCount(deps.env, 'MEASURE_SEQUENTIAL', DEFAULT_SEQUENTIAL_CYCLES);
  const parallelCycles = envCount(deps.env, 'MEASURE_PARALLEL', DEFAULT_PARALLEL_CYCLES);
  const total = sequentialCycles + parallelCycles;
  const timer = deps.timer ?? (() => performance.now());
  const rate: RateLog = { count429: 0, retryAfter: [] };
  const startedAtMs = Date.now();
  // Short per-run prefix: request ids differ between runs, and stay short enough to
  // pass the evidence token lint (no 40 character word-like strings).
  const prefix = createHash('sha256').update(ctx.runId).digest('hex').slice(0, 8);

  const token = await fetchAccessToken(
    ctx.http,
    'measure.0 token',
    ctx.config.clientId,
    ctx.config.clientSecret,
  );
  const auth = { Authorization: `Bearer ${token}` };

  const timed = async (
    op: MeasuredOp,
    step: string,
    req: Parameters<GateContext['http']['request']>[1],
  ): Promise<{ sample: Sample; json: unknown }> => {
    const t0 = timer();
    try {
      const res = await ctx.http.request(step, req);
      const ms = round2(timer() - t0);
      if (res.status === 429) {
        rate.count429 += 1;
        const ra = res.headers['retry-after'];
        if (ra !== undefined) rate.retryAfter.push(ra);
      }
      return {
        sample: { op, ms, ok: res.status >= 200 && res.status < 300 },
        json: res.json,
      };
    } catch {
      return { sample: { op, ms: round2(timer() - t0), ok: false }, json: undefined };
    }
  };

  // Step 1: create every order. Latencies are stored in the run file so a resumed
  // run keeps them.
  const prepared = await ctx.step('measure.1 create orders', async (): Promise<Json> => {
    const orders: Json[] = [];
    const samples: Json[] = [];
    for (let i = 0; i < total; i += 1) {
      const { sample, json } = await timed('order', `measure.1.${i + 1} create order`, {
        method: 'POST',
        path: '/v2/checkout/orders',
        headers: { ...auth, 'PayPal-Request-Id': `${prefix}-order-${i + 1}` },
        body: {
          intent: 'AUTHORIZE',
          purchase_units: [
            {
              reference_id: `measure-${i + 1}`,
              custom_id: `measure-${i + 1}`,
              amount: { currency_code: gateCurrency(), value: '5.00' },
            },
          ],
        },
      });
      samples.push({ op: sample.op, ms: sample.ms, ok: sample.ok });
      const id = isRecord(json) && typeof json['id'] === 'string' ? json['id'] : '';
      orders.push({ orderId: id, approveUrl: approveLink(json) });
    }
    return { orders, samples };
  });
  const stored = prepared as unknown as { orders: PreparedOrder[]; samples: Sample[] };
  const orders = stored.orders;
  const orderSamples = stored.samples;

  // Step 2: buyer approval.
  if (deps.approveOrder !== undefined) {
    for (const o of orders) if (o.orderId !== '') deps.approveOrder(o.orderId);
  } else {
    const first = orders.find((o) => o.approveUrl !== '');
    await ctx.waitForApproval(
      'measure.2 approve orders',
      first?.approveUrl ?? '',
      `approve all ${orders.length} orders; the links are in ${ctx.evidencePath}`,
    );
  }

  // Step 3: one cycle after authorization of an approved order.
  const cycle = async (index: number, o: PreparedOrder): Promise<Sample[]> => {
    const out: Sample[] = [];
    const n = index + 1;
    const rid = (what: string): Record<string, string> => ({
      ...auth,
      'PayPal-Request-Id': `${prefix}-${what}-${n}`,
    });
    if (o.orderId === '') return out;
    const a = await timed('authorize', `measure.3.${n} authorize`, {
      method: 'POST',
      path: `/v2/checkout/orders/${o.orderId}/authorize`,
      headers: rid('authorize'),
    });
    out.push(a.sample);
    if (!a.sample.ok) return out;
    const units =
      isRecord(a.json) && Array.isArray(a.json['purchase_units']) ? a.json['purchase_units'] : [];
    const unit = isRecord(units[0]) ? units[0] : {};
    const payments = isRecord(unit['payments']) ? unit['payments'] : {};
    const auths = Array.isArray(payments['authorizations']) ? payments['authorizations'] : [];
    const authId = isRecord(auths[0]) && typeof auths[0]['id'] === 'string' ? auths[0]['id'] : '';
    if (authId === '') {
      out.push({ op: 'capture', ms: 0, ok: false });
      return out;
    }
    const c = await timed('capture', `measure.3.${n} capture`, {
      method: 'POST',
      path: `/v2/payments/authorizations/${authId}/capture`,
      headers: rid('capture'),
      body: {
        amount: { currency_code: gateCurrency(), value: '2.00' },
        final_capture: false,
        invoice_id: `${prefix}-${n}`,
      },
    });
    out.push(c.sample);
    const v = await timed('void', `measure.3.${n} void`, {
      method: 'POST',
      path: `/v2/payments/authorizations/${authId}/void`,
      headers: rid('void'),
    });
    out.push(v.sample);
    return out;
  };

  const phase = async (
    name: string,
    from: number,
    count: number,
    concurrency: number,
  ): Promise<PhaseReport> => {
    const samples: Sample[] = [...orderSamples.slice(from, from + count)];
    let completed = 0;
    let failed = 0;
    const slice = orders.slice(from, from + count);
    const runOne = async (i: number): Promise<void> => {
      const o = slice[i];
      if (o === undefined) return;
      const result = await cycle(from + i, o);
      samples.push(...result);
      const ok = result.length === 3 && result.every((s) => s.ok);
      if (ok) completed += 1;
      else failed += 1;
    };
    if (concurrency === 1) {
      for (let i = 0; i < slice.length; i += 1) await runOne(i);
    } else {
      await Promise.all(slice.map((_, i) => runOne(i)));
    }
    const ops: Partial<Record<MeasuredOp, Percentiles>> = {};
    for (const op of MEASURED_OPS) {
      const mine = samples.filter((s) => s.op === op);
      if (mine.length === 0) continue;
      ops[op] = summarize(
        mine.filter((s) => s.ok).map((s) => s.ms),
        mine.filter((s) => !s.ok).length,
      );
    }
    ctx.log(`${name}: ${completed} of ${slice.length} cycles completed`);
    return {
      cycles: slice.length,
      completed,
      failed,
      concurrency,
      ops: ops as PhaseReport['ops'],
    };
  };

  const sequential = await phase('sequential', 0, sequentialCycles, 1);
  const parallel = await phase('parallel', sequentialCycles, parallelCycles, parallelCycles);
  const table = renderTable(sequential, parallel, rate);

  const report: MeasureReport = MeasureReport.parse({
    v: 1,
    runId: ctx.runId,
    fake: ctx.args.fake,
    scriptVersion: MEASURE_SCRIPT_VERSION,
    startedAtMs,
    sequential,
    parallel,
    rateLimit: { count429: rate.count429, retryAfter: rate.retryAfter },
    table,
  });
  const outRoot = ctx.args.out ?? (ctx.args.fake ? join(tmpdir(), 'gavel-gates') : 'docs/evidence');
  const path = join(outRoot, 'measure', `${ctx.runId}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  ctx.log(table);
  ctx.log(`report: ${path}`);
}

export interface RunMeasureOptions {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  log?: (message: string) => void;
}

/**
 * Entry point behind `npm run measure`. With --fake it starts the fake PayPal
 * server on a loopback port for the duration of the run. Returns the exit code.
 */
export async function runMeasure(opts: RunMeasureOptions): Promise<number> {
  const log = opts.log ?? ((m: string) => console.log(m));
  let fake: boolean;
  try {
    fake = parseGateArgs(opts.argv).fake;
  } catch (e) {
    if (e instanceof GateUsageError) {
      log(`refused: ${e.message}`);
      return EXIT_REFUSED;
    }
    throw e;
  }
  let server: FakePayPalServer | undefined;
  let env = { ...opts.env };
  if (fake) {
    server = new FakePayPalServer();
    await server.start();
    env = { ...env, PAYPAL_ENV: env['PAYPAL_ENV'] ?? 'sandbox', PAYPAL_BASE_URL: server.url };
  }
  const sha = env['GITHUB_SHA'];
  try {
    return await runGate({
      gate: 'measure',
      scriptVersion: sha !== undefined && sha !== '' ? sha.slice(0, 7) : MEASURE_SCRIPT_VERSION,
      argv: opts.argv,
      env,
      log,
      main: (ctx) => {
        const srv = server;
        return measureGate(ctx, {
          env,
          ...(srv !== undefined ? { approveOrder: (id: string) => srv.core.approveOrder(id) } : {}),
        });
      },
    });
  } finally {
    await server?.stop();
  }
}

// Runs when the file is the script being executed (node or vite-node), not when imported.
// vite-node drops the script from argv, so its own binary name marks the entry run.
const isEntry =
  /vite-node/.test(process.argv[1] ?? '') ||
  process.argv.slice(1).some((a) => pathToFileURL(resolve(a)).href === import.meta.url);
if (isEntry) {
  runMeasure({ argv: process.argv.slice(2), env: process.env }).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    },
  );
}
