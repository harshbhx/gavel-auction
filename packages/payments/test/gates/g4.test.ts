import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lintJsonl } from '../../gates/evidence.js';
import { DEFAULT_FAKE_WEBHOOK_ID, FakePayPalServer } from '../../src/fake/server.js';
import {
  diffKeys,
  g4Gate,
  fixtureName,
  parseReceiverLog,
  runG4,
  sanitizeEvent,
  simulatorShapes,
  summarizeEvent,
} from '../../gates/g4.js';
import { EXIT_FAILED, EXIT_OK, EXIT_REFUSED, runGate } from '../../gates/runner.js';

let out: string;
let lines: string[];

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'gavel-g4-test-'));
  lines = [];
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

const log = (m: string): void => {
  lines.push(m);
};

describe('parseReceiverLog', () => {
  it('reads deliveries and upper-cases header names', () => {
    const text = `${JSON.stringify({ headers: { 'paypal-transmission-id': 'T1' }, rawBody: '{}' })}\n\n`;
    expect(parseReceiverLog(text)).toEqual([
      { headers: { 'PAYPAL-TRANSMISSION-ID': 'T1' }, rawBody: '{}' },
    ]);
  });
  it('names the bad line', () => {
    expect(() => parseReceiverLog('nope')).toThrow('line 1 is not JSON');
    expect(() => parseReceiverLog('{"headers":{}}')).toThrow('line 1 needs');
  });
});

describe('summarizeEvent', () => {
  it('reads type, id and key sets', () => {
    const s = summarizeEvent('{"id":"E1","event_type":"X.Y","resource":{"b":1,"a":2},"z":0}');
    expect(s).toEqual({
      id: 'E1',
      eventType: 'X.Y',
      topKeys: ['event_type', 'id', 'resource', 'z'],
      resourceKeys: ['a', 'b'],
      linkedIds: [],
    });
  });
  it('rejects anything that is not an event', () => {
    expect(summarizeEvent('[]')).toBeUndefined();
    expect(summarizeEvent('{"id":1}')).toBeUndefined();
    expect(summarizeEvent('not json')).toBeUndefined();
  });
});

describe('diffKeys', () => {
  it('lists keys on each side only', () => {
    expect(diffKeys(['a', 'b'], ['b', 'c'])).toEqual({ onlyReal: ['a'], onlySimulator: ['c'] });
  });
});

describe('sanitizeEvent', () => {
  it('redacts personal fields', () => {
    const text = sanitizeEvent(
      JSON.stringify({
        id: 'E1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { payer: { email_address: 'someone@example.com', payer_id: 'P1' }, id: 'C1' },
      }),
    );
    expect(text).not.toContain('someone@example.com');
    expect(text).toContain('[REDACTED]');
  });
  it('stops on a leftover token-shaped value', () => {
    const body = JSON.stringify({
      id: 'E1',
      event_type: 'X',
      resource: { note: 'A'.repeat(48) },
    });
    expect(() => sanitizeEvent(body)).toThrow('sensitive');
  });
});

describe('fixtureName', () => {
  it('slugs the event type', () => {
    expect(fixtureName('PAYMENT.CAPTURE.COMPLETED', 2)).toBe('payment-capture-completed-02.json');
  });
});

describe('simulatorShapes', () => {
  it('knows the capture and the void event', () => {
    const shapes = simulatorShapes();
    expect(shapes.has('PAYMENT.CAPTURE.COMPLETED')).toBe(true);
    expect(shapes.has('PAYMENT.AUTHORIZATION.VOIDED')).toBe(true);
  });
});

describe('G4 against the fake', () => {
  it('verifies the deliveries and writes fixtures and evidence', async () => {
    const code = await runG4({ argv: ['--fake', '--out', out], env: {}, log });
    expect(code).toBe(EXIT_OK);
    const fixtures = readdirSync(join(out, 'G4', 'fixtures'));
    expect(fixtures).toContain('payment-capture-completed-01.json');
    expect(fixtures).toContain('payment-authorization-voided-01.json');
    const dir = join(out, 'G4');
    const file = readdirSync(dir).find((f) => f.endsWith('.jsonl')) ?? '';
    const text = readFileSync(join(dir, file), 'utf8');
    expect(lintJsonl(text)).toEqual([]);
    expect(text).not.toContain('transmission_sig');
    expect(text).toContain('"verification":"SUCCESS"');
  });

  it('refuses a real run without a log file', async () => {
    const code = await runG4({ argv: ['--out', out], env: { PAYPAL_ENV: 'sandbox' }, log });
    expect(code).toBe(EXIT_REFUSED);
    expect(lines.join('\n')).toContain('--log');
  });
});

describe('G4 with a delivery that does not verify', () => {
  it('writes no fixture for it and fails the run', async () => {
    const server = new FakePayPalServer();
    await server.start();
    try {
      const forged = JSON.stringify({
        id: 'WH-FORGED',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { id: 'C1' },
      });
      const fixturesDir = join(out, 'fixtures');
      const verdict = async (): Promise<Response> =>
        new Response(JSON.stringify({ verification_status: 'FAILURE' }), { status: 200 });
      const code = await runGate({
        gate: 'G4',
        scriptVersion: 'test',
        argv: ['--fake', '--out', out],
        env: {
          PAYPAL_ENV: 'sandbox',
          PAYPAL_BASE_URL: server.url,
          PAYPAL_WEBHOOK_ID: DEFAULT_FAKE_WEBHOOK_ID,
        },
        log,
        main: (ctx) =>
          g4Gate(ctx, {
            deliveries: [{ headers: {}, rawBody: forged }],
            fixturesDir,
            fake: true,
            fetch: verdict,
          }),
      });
      expect(code).toBe(EXIT_FAILED);
      expect(readdirSync(fixturesDir)).toEqual([]);
    } finally {
      await server.stop();
    }
  });
});

describe('G4 coverage needs this run (R6-E03)', () => {
  const capture = (authId: string): string =>
    JSON.stringify({
      id: `WH-${authId}`,
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: `CAP-${authId}`, supplementary_data: { related_ids: { authorization_id: authId } } },
    });
  const voided = (authId: string): string =>
    JSON.stringify({
      id: `WHV-${authId}`,
      event_type: 'PAYMENT.AUTHORIZATION.VOIDED',
      resource: { id: authId },
    });

  async function run(
    rawBodies: string[],
    runIds: Record<string, string[]> | undefined,
  ): Promise<number> {
    const server = new FakePayPalServer();
    await server.start();
    try {
      const ok = async (): Promise<Response> =>
        new Response(JSON.stringify({ verification_status: 'SUCCESS' }), { status: 200 });
      return await runGate({
        gate: 'G4',
        scriptVersion: 'test',
        argv: ['--fake', '--out', out],
        env: {
          PAYPAL_ENV: 'sandbox',
          PAYPAL_BASE_URL: server.url,
          PAYPAL_WEBHOOK_ID: DEFAULT_FAKE_WEBHOOK_ID,
        },
        log,
        main: (ctx) =>
          g4Gate(ctx, {
            deliveries: rawBodies.map((rawBody) => ({ headers: {}, rawBody })),
            fixturesDir: join(out, 'fixtures'),
            fake: true,
            fetch: ok,
            ...(runIds ? { runIds } : {}),
          }),
      });
    } finally {
      await server.stop();
    }
  }

  const ids = {
    'PAYMENT.CAPTURE.COMPLETED': ['ORD-NEW', 'AUTH-NEW'],
    'PAYMENT.AUTHORIZATION.VOIDED': ['ORD-NEW2', 'AUTH-NEW2'],
  };

  it('fails when only an older run delivered a capture and a void', async () => {
    expect(await run([capture('AUTH-OLD'), voided('AUTH-OLD2')], ids)).toBe(EXIT_FAILED);
  });

  it('fails when only the capture is from this run', async () => {
    expect(await run([capture('AUTH-NEW'), voided('AUTH-OLD2')], ids)).toBe(EXIT_FAILED);
  });

  it('passes when both events name this run ids', async () => {
    expect(await run([capture('AUTH-NEW'), voided('AUTH-NEW2')], ids)).toBe(EXIT_OK);
  });

  it('keeps the old behaviour without run ids', async () => {
    expect(await run([capture('AUTH-OLD'), voided('AUTH-OLD2')], undefined)).toBe(EXIT_OK);
  });
});
