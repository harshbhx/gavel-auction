import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lintJsonl, lintTokens } from '../../gates/evidence.js';
import { FakePayPalServer } from '../../src/fake/server.js';
import {
  decideG2,
  g2Finished,
  g2RequestId,
  G2_TOKEN_HEADER,
  runG2,
  startG2Server,
} from '../../gates/g2/server.js';
import { EXIT_OK, EXIT_REFUSED, runGate } from '../../gates/runner.js';

let out: string;
let lines: string[];

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'gavel-g2-test-'));
  lines = [];
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

function run(argv: string[]) {
  return runG2({
    argv: ['--fake', '--out', out, ...argv],
    env: { PAYPAL_ENV: 'sandbox' },
    log: (m) => lines.push(m),
  });
}

describe('decideG2 (SPEC 7.3)', () => {
  const ok = { outcome: 'authorized' as const, orderId: 'O', authId: 'A' };
  it('passes when wallet and card are authorized', () => {
    expect(decideG2({ wallet: ok, card: ok }).decision).toBe('PASS');
  });
  it('passes with fallback when the card path is not offered or fails', () => {
    expect(decideG2({ wallet: ok, card: { outcome: 'not_offered' } }).decision).toBe(
      'PASS-WITH-FALLBACK',
    );
    expect(decideG2({ wallet: ok, card: { outcome: 'error' } }).decision).toBe(
      'PASS-WITH-FALLBACK',
    );
  });
  it('fails when the wallet path does not authorize', () => {
    expect(decideG2({ wallet: { outcome: 'error' }, card: ok }).decision).toBe('FAIL');
    expect(decideG2({ card: ok }).decision).toBe('FAIL');
  });
  it('finishes only when both paths are final', () => {
    expect(g2Finished({ wallet: ok })).toBe(false);
    expect(g2Finished({ wallet: ok, card: { outcome: 'cancelled' } })).toBe(false);
    expect(g2Finished({ wallet: ok, card: { outcome: 'not_offered' } })).toBe(true);
  });
});

describe('G2 against the fake (T-PAY-091)', () => {
  it('records order and authorization ids for wallet and card', async () => {
    const code = await run([]);
    expect(code).toBe(EXIT_OK);
    const gates = readFileSync(join(out, 'GATES.md'), 'utf8');
    expect(gates).toContain('## G2 card and guest AUTHORIZE');
    expect(gates).toContain('Decision: PASS');
    expect(gates).toMatch(/G2 wallet AUTHORIZE \| .*authorization /);
    const dir = join(out, 'G2');
    const file = readdirSync(dir).find((f) => f.endsWith('.jsonl')) ?? '';
    const text = readFileSync(join(dir, file), 'utf8');
    expect(lintJsonl(text)).toEqual([]);
    const ids = text
      .split('\n')
      .filter((l) => l.includes('order and authorization ids'))
      .map((l) => JSON.parse(l) as { buyer: string });
    expect(ids.map((r) => r.buyer).sort()).toEqual(['card', 'wallet']);
  });

  it('card not offered: PASS-WITH-FALLBACK', async () => {
    const code = await run(['--fake-card', 'not-offered']);
    expect(code).toBe(EXIT_OK);
    expect(readFileSync(join(out, 'GATES.md'), 'utf8')).toContain('Decision: PASS-WITH-FALLBACK');
  });

  it('refuses a bad flag value', async () => {
    expect(await run(['--fake-card', 'maybe'])).toBe(EXIT_REFUSED);
    expect(await run(['--port', 'x'])).toBe(EXIT_REFUSED);
  });
});

describe('G2 page server access control', () => {
  it('rejects cross-site and token-less calls and reports the gate currency', async () => {
    const fake = new FakePayPalServer();
    await fake.start();
    const seen: Record<string, unknown> = {};
    try {
      await runGate({
        gate: 'G2',
        scriptVersion: 'test',
        argv: ['--fake', '--out', out],
        env: { PAYPAL_ENV: 'sandbox', PAYPAL_BASE_URL: fake.url, GATE_CURRENCY: 'inr' },
        log: (m) => lines.push(m),
        main: async (ctx) => {
          const srv = await startG2Server(
            ctx,
            'tok',
            { pageHtml: '<html><head></head></html>', sdkUrl: 'x', domain: 'localhost' },
            0,
          );
          try {
            const json = { 'Content-Type': 'application/json' };
            const body = JSON.stringify({ path: 'wallet', outcome: 'not_offered' });
            const post = (headers: Record<string, string>) =>
              fetch(`${srv.url}/api/report`, { method: 'POST', headers, body });
            seen['page'] = await (await fetch(srv.url)).text();
            seen['noToken'] = (await post(json)).status;
            const withToken = { ...json, [G2_TOKEN_HEADER]: srv.pageToken };
            seen['crossOrigin'] = (
              await post({ ...withToken, Origin: 'https://evil.test' })
            ).status;
            seen['textPlain'] = (await post({ ...withToken, 'Content-Type': 'text/plain' })).status;
            seen['forged'] = srv.results.wallet;
            seen['ok'] = (await post(withToken)).status;
            const cfg = await fetch(`${srv.url}/api/config`, {
              headers: { [G2_TOKEN_HEADER]: srv.pageToken },
            });
            seen['currency'] = ((await cfg.json()) as { currency: string }).currency;
            seen['token'] = srv.pageToken;
          } finally {
            await srv.close();
          }
        },
      });
    } finally {
      await fake.stop();
    }
    expect(seen['page']).toContain(`content="${String(seen['token'])}"`);
    expect([seen['noToken'], seen['crossOrigin'], seen['textPlain']]).toEqual([403, 403, 415]);
    expect(seen['forged']).toBeUndefined();
    expect(seen['ok']).toBe(200);
    expect(seen['currency']).toBe('INR');
  });
});

describe('G2 PayPal-Request-Id', () => {
  it('stays clear of the evidence token lint at the longest run id', () => {
    // A 14-character run id is the longest startG2Server builds. The old authorize key embedded
    // the 17-character sandbox order id, reached 47 characters and stopped the real run.
    const run = '20261105T1146Z';
    for (const path of ['wallet', 'card'] as const) {
      for (const op of ['order', 'auth'] as const) {
        const id = g2RequestId(run, path, op, 99);
        expect(id.length).toBeLessThan(40);
        expect(lintTokens({ headers: { 'PayPal-Request-Id': id } })).toEqual([]);
      }
    }
  });
});
