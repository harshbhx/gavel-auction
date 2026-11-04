import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { clearRegisteredSecrets, logPayment, registerSecret, setLogSink } from '../src/log.js';

function capture(fn: () => void): string[] {
  const lines: string[] = [];
  const prev = setLogSink((l) => lines.push(l));
  try {
    fn();
  } finally {
    setLogSink(prev);
  }
  return lines;
}

afterEach(() => clearRegisteredSecrets());

describe('logPayment', () => {
  it('T-PAY-007 redacts tokens, secrets, Basic header and signatures', () => {
    registerSecret('s3cr3t-value-xyz');
    const basic = 'Basic dXNlcjpwYXNz';
    const sig = 'MEUCIQDsignaturebytes';
    const token = 'A21AAFakeAccessToken123';
    const lines = capture(() => {
      logPayment({
        op: 'capture',
        requestId: 'gv1-x',
        message: `header Authorization: ${basic} secret s3cr3t-value-xyz`,
        error: new Error(`failed access_token=${token} paypal-transmission-sig: ${sig}`),
      });
      logPayment({ op: 'webhook', message: `Bearer ${token}` });
    });
    const out = lines.join('\n');
    expect(out).toContain('[REDACTED]');
    for (const s of ['dXNlcjpwYXNz', sig, token, 's3cr3t-value-xyz']) expect(out).not.toContain(s);
  });

  it('writes the R-PAY-130 JSON line', () => {
    const [line] = capture(() =>
      logPayment({
        ts: 5,
        op: 'void',
        requestId: 'r',
        attempt: 1,
        status: 200,
        debugId: 'd',
        latencyMs: 12,
        outcome: 'definite',
        holdId: 'h',
      }),
    );
    expect(JSON.parse(line ?? '')).toMatchObject({
      ts: 5,
      level: 'info',
      op: 'void',
      requestId: 'r',
      attempt: 1,
      status: 200,
      debugId: 'd',
      latencyMs: 12,
      outcome: 'definite',
      holdId: 'h',
    });
  });

  it('no console.log in src outside log.ts', () => {
    const root = fileURLToPath(new URL('../src/', import.meta.url));
    const files = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.ts') && d.name !== 'log.ts')
      .map((d) => join(d.parentPath, d.name));
    for (const f of files) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/console\.(log|info|warn|error|debug)/);
    }
  });
});
