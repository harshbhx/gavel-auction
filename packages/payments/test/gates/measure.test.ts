import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MeasureReport,
  measureGate,
  percentile,
  renderTable,
  runMeasure,
  summarize,
} from '../../gates/measure.js';
import { EXIT_FAILED, EXIT_OK, EXIT_REFUSED, runGate } from '../../gates/runner.js';
import type { RawFetch } from '../../gates/http.js';
import { lintJsonl } from '../../gates/evidence.js';

let out: string;
let lines: string[];

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'gavel-measure-test-'));
  lines = [];
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

function run(extraArgv: string[], env: Record<string, string | undefined> = {}) {
  return runMeasure({
    argv: ['--fake', '--out', out, ...extraArgv],
    env: { PAYPAL_ENV: 'sandbox', ...env },
    log: (m) => lines.push(m),
  });
}

function readReport(): MeasureReport {
  const dir = join(out, 'measure');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.run.json'));
  expect(files).toHaveLength(1);
  return MeasureReport.parse(JSON.parse(readFileSync(join(dir, files[0] ?? ''), 'utf8')));
}

describe('percentiles', () => {
  it('uses nearest rank on a sorted list', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 99)).toBe(99);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 50)).toBe(0);
  });

  it('summarize keeps min <= p50 <= p95 <= p99 <= max for unsorted input', () => {
    const s = summarize([9, 1, 5, 3, 7, 2, 8, 4, 6, 10], 2);
    expect(s).toMatchObject({ count: 10, failures: 2, min: 1, p50: 5, p95: 10, p99: 10, max: 10 });
  });

  it('renders one row per phase and operation', () => {
    const p = summarize([1, 2, 3], 0);
    const phase = {
      cycles: 3,
      completed: 3,
      failed: 0,
      concurrency: 1,
      ops: { order: p, authorize: p, capture: p, void: p },
    };
    const table = renderTable(phase, phase, { count429: 2, retryAfter: ['1', '3'] });
    expect(table.split('\n').filter((l) => l.startsWith('| sequential'))).toHaveLength(4);
    expect(table.split('\n').filter((l) => l.startsWith('| parallel'))).toHaveLength(4);
    expect(table).toContain('429 answers: 2. Retry-After values: 1, 3.');
  });
});

describe('npm run measure -- --fake (T-PAY-080)', { timeout: 30_000 }, () => {
  it('runs 50 sequential and 10 parallel cycles and writes a valid report', async () => {
    const code = await run([]);
    expect(code).toBe(EXIT_OK);
    const report = readReport();
    expect(report.fake).toBe(true);
    expect(report.sequential).toMatchObject({
      cycles: 50,
      completed: 50,
      failed: 0,
      concurrency: 1,
    });
    expect(report.parallel).toMatchObject({
      cycles: 10,
      completed: 10,
      failed: 0,
      concurrency: 10,
    });
    for (const phase of [report.sequential, report.parallel]) {
      for (const op of ['authorize', 'capture', 'void'] as const) {
        const p = phase.ops[op];
        expect(p?.count).toBe(phase.cycles);
        expect(p?.p50 ?? -1).toBeLessThanOrEqual(p?.p95 ?? -2);
        expect(p?.p95 ?? -1).toBeLessThanOrEqual(p?.p99 ?? -2);
      }
    }
    expect(report.sequential.ops.order?.count).toBe(50);
    expect(report.rateLimit).toEqual({ count429: 0, retryAfter: [] });
    expect(report.table).toContain('| sequential | authorize |');
  });

  it('writes valid evidence with no token-shaped values', async () => {
    expect(await run([], { MEASURE_SEQUENTIAL: '3', MEASURE_PARALLEL: '2' })).toBe(EXIT_OK);
    const files = readdirSync(join(out, 'measure')).filter((f) => f.endsWith('.jsonl'));
    expect(files).toHaveLength(1);
    const text = readFileSync(join(out, 'measure', files[0] ?? ''), 'utf8');
    expect(text.split('\n').filter((l) => l !== '').length).toBeGreaterThan(10);
    expect(lintJsonl(text)).toEqual([]);
  });

  it('honors MEASURE_SEQUENTIAL and MEASURE_PARALLEL', async () => {
    const code = await run([], { MEASURE_SEQUENTIAL: '4', MEASURE_PARALLEL: '3' });
    expect(code).toBe(EXIT_OK);
    const report = readReport();
    expect(report.sequential.cycles).toBe(4);
    expect(report.parallel.cycles).toBe(3);
  });

  it('refuses unknown arguments and a non-sandbox environment', async () => {
    expect(await run(['--bogus'])).toBe(EXIT_REFUSED);
    const code = await runMeasure({
      argv: ['--fake', '--out', out],
      env: { PAYPAL_ENV: 'live' },
      log: (m) => lines.push(m),
    });
    expect(code).toBe(EXIT_REFUSED);
  });

  it('refuses a real run without sandbox credentials before sending anything', async () => {
    const code = await runMeasure({
      argv: ['--out', out],
      env: { PAYPAL_ENV: 'sandbox' },
      log: (m) => lines.push(m),
    });
    expect(code).toBe(EXIT_REFUSED);
  });
});

describe('measure gate exit code (R-PAY-147)', () => {
  it('exits non-zero when every order create fails', async () => {
    const fetchStub: RawFetch = async (url) => {
      const isToken = url.includes('/v1/oauth2/token');
      const body = isToken ? { access_token: 'tok', expires_in: 100, token_type: 'Bearer' } : {};
      return {
        status: isToken ? 200 : 500,
        headers: { forEach: () => undefined },
        text: async () => JSON.stringify(body),
      };
    };
    const env = {
      PAYPAL_ENV: 'sandbox',
      PAYPAL_BASE_URL: 'http://127.0.0.1:1',
      MEASURE_SEQUENTIAL: '2',
      MEASURE_PARALLEL: '2',
    };
    const code = await runGate({
      gate: 'measure',
      scriptVersion: 'test',
      argv: ['--fake', '--out', out],
      env,
      log: (m) => lines.push(m),
      fetch: fetchStub,
      main: (ctx) => measureGate(ctx, { env, approveOrder: () => undefined }),
    });
    expect(code).toBe(EXIT_FAILED);
    expect(readReport().sequential.completed).toBe(0);
  });
});
