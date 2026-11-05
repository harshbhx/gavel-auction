import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cardBuyerAvailable,
  diffLedger,
  gateClosed,
  isTransientStatus,
  retryTransient,
  sandboxAvailability,
  settle,
  stagingAvailability,
  writeSpecResult,
  writeTranscript,
  type GateFlags,
} from '../src/sandbox/harness';

const open: GateFlags = {
  g1_remainder_mode: 'unknown',
  g2_card_authorize: false,
  g4_webhooks_verified: false,
};
const closed: GateFlags = {
  g1_remainder_mode: 'A',
  g2_card_authorize: true,
  g4_webhooks_verified: true,
};

// Values are built at run time; no secret-looking literal sits in the repository.
const filler = 'x'.repeat(40);
const fullEnv = {
  PAYPAL_CLIENT_ID: filler,
  PAYPAL_CLIENT_SECRET: filler,
  SANDBOX_BUYER_EMAIL: `${'b'.repeat(6)}@example.test`,
  SANDBOX_BUYER_PASSWORD: filler,
};

describe('availability', () => {
  it('is ok with every secret present', () => {
    expect(sandboxAvailability(fullEnv)).toEqual({ ok: true, missing: [] });
  });

  it('names the missing secrets and never their values', () => {
    const r = sandboxAvailability({
      ...fullEnv,
      SANDBOX_BUYER_PASSWORD: '',
      PAYPAL_CLIENT_ID: undefined,
    });
    expect(r.ok).toBe(false);
    expect(r.missing.sort()).toEqual(['PAYPAL_CLIENT_ID', 'SANDBOX_BUYER_PASSWORD']);
    expect(JSON.stringify(r)).not.toContain(filler);
  });

  it('is skipped on an empty environment, as on a fork pull request', () => {
    expect(sandboxAvailability({}).ok).toBe(false);
  });

  it('refuses a PAYPAL_ENV other than sandbox', () => {
    expect(sandboxAvailability({ ...fullEnv, PAYPAL_ENV: 'live' }).ok).toBe(false);
    expect(sandboxAvailability({ ...fullEnv, PAYPAL_ENV: 'sandbox' }).ok).toBe(true);
  });

  it('checks staging and the card buyer separately', () => {
    expect(stagingAvailability({}).missing).toEqual([
      'GAVEL_STAGING_URL',
      'GAVEL_STAGING_ADMIN_KEY',
    ]);
    expect(cardBuyerAvailable({})).toBe(false);
    expect(
      cardBuyerAvailable({
        SANDBOX_CARD_BUYER_EMAIL: 'a@example.test',
        SANDBOX_CARD_BUYER_PASSWORD: filler,
      }),
    ).toBe(true);
  });
});

describe('gate status', () => {
  it('reads closed gates from the flags; G3 has no flag', () => {
    expect(gateClosed('G1', open)).toBe(false);
    expect(gateClosed('G1', closed)).toBe(true);
    expect(gateClosed('G2', closed)).toBe(true);
    expect(gateClosed('G4', closed)).toBe(true);
    expect(gateClosed('G3', closed)).toBe(false);
  });

  it('reports inconclusive, not fail, before the gate closes', () => {
    expect(settle('G1', false, open)).toBe('inconclusive');
    expect(settle('G1', false, closed)).toBe('fail');
    expect(settle('G3', false, closed)).toBe('inconclusive');
    expect(settle('G1', true, open)).toBe('pass');
  });
});

describe('retryTransient', () => {
  const waits: number[] = [];
  const sleep = (ms: number): Promise<void> => {
    waits.push(ms);
    return Promise.resolve();
  };

  it('classifies transient statuses', () => {
    expect([0, 429, 500, 503].every(isTransientStatus)).toBe(true);
    expect([200, 201, 400, 404, 422].some(isTransientStatus)).toBe(false);
  });

  it('retries with doubling waits and returns the first good answer', async () => {
    waits.length = 0;
    const answers = [503, 429, 201];
    const r = await retryTransient(async () => ({ status: answers.shift() ?? 0 }), {
      sleep,
      baseMs: 100,
    });
    expect(r.status).toBe(201);
    expect(waits).toEqual([100, 200]);
  });

  it('gives back the last transient answer after the attempts are used', async () => {
    waits.length = 0;
    const r = await retryTransient(async () => ({ status: 503 }), {
      sleep,
      attempts: 3,
      baseMs: 10,
    });
    expect(r.status).toBe(503);
    expect(waits).toEqual([10, 20]);
  });

  it('does not retry a definite answer', async () => {
    waits.length = 0;
    let calls = 0;
    await retryTransient(async () => ({ status: (calls += 1) && 422 }), { sleep });
    expect(calls).toBe(1);
  });

  it('rethrows a network error after the last attempt', async () => {
    const boom = async (): Promise<{ status: number }> => {
      throw new Error('down');
    };
    await expect(retryTransient(boom, { sleep, attempts: 2 })).rejects.toThrow('down');
  });
});

describe('ledger comparison', () => {
  it('finds no difference when both sides agree', () => {
    const rows = [
      { id: 'hold-1', status: 'CAPTURED', capturedCents: 100 },
      { id: 'hold-2', status: 'VOIDED', capturedCents: 0 },
    ];
    expect(diffLedger(rows, [...rows].reverse())).toEqual([]);
  });

  it('reports status, amount, missing and extra rows', () => {
    const diffs = diffLedger(
      [
        { id: 'a', status: 'CAPTURED', capturedCents: 100 },
        { id: 'b', status: 'VOIDED', capturedCents: 0 },
      ],
      [
        { id: 'a', status: 'CREATED', capturedCents: 90 },
        { id: 'c', status: 'VOIDED', capturedCents: 0 },
      ],
    );
    expect(diffs).toEqual([
      'a: status CAPTURED here, CREATED at PayPal',
      'a: captured 100 here, 90 at PayPal',
      'b: missing at PayPal',
      'c: not in our ledger',
    ]);
  });
});

describe('result files', () => {
  it('writes a result and a transcript', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sbx-'));
    writeSpecResult(dir, {
      spec: 'R1',
      gate: 'G1',
      status: 'pass',
      observed: 'ok',
      facts: { n: 1 },
      finishedAt: '2026-11-05T00:00:00Z',
    });
    writeTranscript(dir, 'R1', ['{"a":1}', '{"b":2}']);
    expect(readdirSync(dir).sort()).toEqual(['R1.json', 'R1.transcript.jsonl']);
    expect(JSON.parse(readFileSync(join(dir, 'R1.json'), 'utf8')).status).toBe('pass');
    expect(readFileSync(join(dir, 'R1.transcript.jsonl'), 'utf8')).toBe('{"a":1}\n{"b":2}\n');
  });
});
