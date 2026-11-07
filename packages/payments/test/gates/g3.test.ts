import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lintJsonl } from '../../gates/evidence.js';
import { orderCreationOk, runG3 } from '../../gates/g3.js';
import {
  CHECKPOINTS,
  DAY_MS,
  decideG3,
  dueCheckpoints,
  nextDueMs,
  type CheckpointResult,
} from '../../gates/g3-timed.js';
import { EXIT_OK, EXIT_REFUSED } from '../../gates/runner.js';

let out: string;
let lines: string[];

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'gavel-g3-test-'));
  lines = [];
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

function run(argv: string[], env: Record<string, string | undefined> = {}) {
  return runG3({
    argv: ['--fake', '--out', out, ...argv],
    env: { PAYPAL_ENV: 'sandbox', ...env },
    log: (m) => lines.push(m),
  });
}

function result(
  id: CheckpointResult['id'],
  captureHttp: number,
  reauthHttp: number,
): CheckpointResult {
  return {
    id,
    statusBefore: 'CREATED',
    captureHttp,
    captureName: '',
    reauthHttp,
    reauthName: '',
    statusAfter: 'CREATED',
  };
}

describe('checkpoint scheduling', () => {
  it('lists the checkpoints whose time has come', () => {
    expect(dueCheckpoints(0, 3 * DAY_MS, [])).toEqual([]);
    expect(dueCheckpoints(0, 3.5 * DAY_MS, [])).toEqual(['d3.5']);
    expect(dueCheckpoints(0, 4.2 * DAY_MS, [])).toEqual(['d3.5', 'd4']);
    expect(dueCheckpoints(0, 9 * DAY_MS, [])).toEqual(['d3.5', 'd4', 'd5']);
    expect(dueCheckpoints(0, 9 * DAY_MS, ['d3.5', 'd4'])).toEqual(['d5']);
  });
  it('reports when the next checkpoint is due', () => {
    expect(nextDueMs(1000, [])).toBe(1000 + 3.5 * DAY_MS);
    expect(nextDueMs(1000, ['d3.5'])).toBe(1000 + 4 * DAY_MS);
    expect(nextDueMs(1000, ['d3.5', 'd4', 'd5'])).toBeUndefined();
  });
});

describe('decideG3 (SPEC 7.3)', () => {
  it('passes when every capture works', () => {
    const v = decideG3([result('d3.5', 201, 422), result('d4', 201, 422), result('d5', 201, 422)]);
    expect(v.decision).toBe('PASS');
    expect(v.fallback).toBe('');
  });
  it('passes with fallback when capture fails but reauthorization works', () => {
    const v = decideG3([result('d3.5', 201, 201), result('d4', 422, 201), result('d5', 422, 201)]);
    expect(v.decision).toBe('PASS-WITH-FALLBACK');
    expect(v.rule).toContain('d4, d5');
  });
  it('fails when both fail', () => {
    const v = decideG3([result('d3.5', 422, 422), result('d4', 422, 422), result('d5', 422, 422)]);
    expect(v.decision).toBe('FAIL');
  });
});

function evidence(): Array<{ step: string; assertion?: { actual: unknown } }> {
  const dir = join(out, 'G3');
  const file = readdirSync(dir).find((f) => f.endsWith('.jsonl')) ?? '';
  const text = readFileSync(join(dir, file), 'utf8');
  expect(lintJsonl(text)).toEqual([]);
  return text
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as { step: string; assertion?: { actual: unknown } });
}

describe('G3 against the fake (T-PAY-092)', () => {
  it('capture after the honor period works: PASS, immediate reauthorize refused', async () => {
    const code = await run([]);
    expect(code).toBe(EXIT_OK);
    expect(lines.some((l) => l.startsWith('G3 decision: PASS.'))).toBe(true);
    const gates = readFileSync(join(out, 'GATES.md'), 'utf8');
    expect(gates).toContain('## G3 honor period, validity and reauthorize');
    expect(gates).toContain('REAUTHORIZATION_TOO_EARLY');
    expect(gates).toContain('Decision: PASS');
    const steps = evidence().map((r) => r.step);
    for (const c of CHECKPOINTS) expect(steps).toContain(`G3.${c.id} reauthorize`);
  });

  it('capture after the honor period fails: PASS-WITH-FALLBACK through reauthorize', async () => {
    const code = await run(['--fake-after-honor', 'fail']);
    expect(code).toBe(EXIT_OK);
    expect(lines.some((l) => l.startsWith('G3 decision: PASS-WITH-FALLBACK.'))).toBe(true);
    expect(readFileSync(join(out, 'GATES.md'), 'utf8')).toContain(
      'AUTHORIZATION_NOT_HONORED_AFTER_HONOR_PERIOD',
    );
  });

  it('appends the GATES entry only once', async () => {
    await run([]);
    const text = readFileSync(join(out, 'GATES.md'), 'utf8');
    expect(text.match(/## G3 honor period/g)).toHaveLength(1);
  });
});

describe('G3 refusals', () => {
  it('names the missing buyer secrets', async () => {
    const code = await runG3({
      argv: ['--browser', '--out', out],
      env: { PAYPAL_ENV: 'sandbox' },
      log: (m) => lines.push(m),
    });
    expect(code).toBe(EXIT_REFUSED);
    expect(lines.join('\n')).toContain('SANDBOX_BUYER_EMAIL, SANDBOX_BUYER_PASSWORD');
  });
  it('rejects a bad flag value', async () => {
    expect(await run(['--fake-after-honor', 'maybe'])).toBe(EXIT_REFUSED);
  });
});

describe('G3 order creation status', () => {
  it('accepts HTTP 200 and 201 with a CREATED or PAYER_ACTION_REQUIRED order', () => {
    expect(orderCreationOk(200, 'PAYER_ACTION_REQUIRED', 'O1', 'https://x')).toBe(true);
    expect(orderCreationOk(201, 'CREATED', 'O1', 'https://x')).toBe(true);
  });

  it('rejects other statuses, missing ids and approved or failed orders', () => {
    expect(orderCreationOk(422, 'CREATED', 'O1', 'https://x')).toBe(false);
    expect(orderCreationOk(200, 'APPROVED', 'O1', 'https://x')).toBe(false);
    expect(orderCreationOk(200, 'CREATED', '', 'https://x')).toBe(false);
    expect(orderCreationOk(200, 'CREATED', 'O1', '')).toBe(false);
  });
});
