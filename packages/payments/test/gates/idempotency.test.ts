import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lintJsonl } from '../../gates/evidence.js';
import {
  LENGTH_PROBES,
  longRequestId,
  renderObservations,
  runIdempotency,
  type Observed,
} from '../../gates/idempotency.js';
import { EXIT_OK, EXIT_REFUSED } from '../../gates/runner.js';

let out: string;
let lines: string[];

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'gavel-idem-test-'));
  lines = [];
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

function run(argv: string[], env: Record<string, string | undefined> = {}) {
  return runIdempotency({
    argv: ['--fake', '--out', out, ...argv],
    env: { PAYPAL_ENV: 'sandbox', ...env },
    log: (m) => lines.push(m),
  });
}

describe('longRequestId', () => {
  it('has the exact length and no run of 40 word characters', () => {
    for (const n of LENGTH_PROBES) {
      const id = longRequestId(n, 'seedabc');
      expect(id).toHaveLength(n);
      expect(/[A-Za-z0-9_-]{40,}/.test(id)).toBe(false);
    }
  });
});

describe('idempotency gate against the fake (T-PAY-095)', () => {
  it('records the observed behaviour and writes clean evidence', async () => {
    const code = await run([]);
    expect(code).toBe(EXIT_OK);
    const table = lines.find((l) => l.startsWith('| probe')) ?? '';
    expect(table).toContain('same id, same body | HTTP 201, replay of the first capture');
    expect(table).toContain('different id, same body | HTTP 201, second capture created');
    expect(table).toContain('DUPLICATE_REQUEST_ID_DIFFERENT_PARAMS');
    expect(table).toContain('accepted up to 128, first refused none');

    const files = readdirSync(join(out, 'idempotency')).filter((f) => f.endsWith('.jsonl'));
    expect(files).toHaveLength(1);
    const text = readFileSync(join(out, 'idempotency', files[0] ?? ''), 'utf8');
    expect(lintJsonl(text)).toEqual([]);
    const records = text
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l) as { step: string; assertion?: { pass: boolean } });
    expect(
      records.some((r) => r.step === 'idem.9 length probe' && r.assertion?.pass === true),
    ).toBe(true);
    expect(records.filter((r) => r.step.startsWith('idem.9 request id'))).toHaveLength(
      LENGTH_PROBES.length,
    );
  });

  it('refuses a real run without sandbox credentials', async () => {
    const code = await runIdempotency({
      argv: ['--out', out],
      env: { PAYPAL_ENV: 'sandbox' },
      log: (m) => lines.push(m),
    });
    expect(code).toBe(EXIT_REFUSED);
  });

  it('refuses unknown arguments', async () => {
    expect(await run(['--bogus'])).toBe(EXIT_REFUSED);
  });
});

describe('renderObservations', () => {
  it('names the first refused length', () => {
    const o: Observed = {
      orderId: 'O',
      authId: 'A',
      firstCapture: { status: 201, id: 'C1' },
      sameIdSameBody: { status: 201, id: 'C1', replayedFirst: true },
      differentId: { status: 201, id: 'C2', createdSecondCapture: true },
      sameIdOtherAmount: { status: 422, name: 'UNPROCESSABLE_ENTITY', issue: 'X' },
      lengths: { '36': 201, '64': 201, '65': 400, '100': 400, '128': 400 },
      largestAccepted: 64,
      firstRefused: 65,
    };
    expect(renderObservations(o)).toContain('accepted up to 64, first refused 65');
  });
});
