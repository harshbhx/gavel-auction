import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PAYMENTS_ENV_KEYS } from '@gavel/payments';
import { describe, expect, it } from 'vitest';
import { CONFIG_KEYS, parseConfig, redactConfig } from '../src/config';

/** Voice and language model keys are read outside the server and payments packages. */
const OTHER_KEYS = ['DEEPGRAM_API_KEY', 'GROQ_API_KEY', 'LLM_API_KEY'];

function readExample(): Record<string, string> {
  const text = readFileSync(
    fileURLToPath(new URL('../../../.env.example', import.meta.url)),
    'utf8',
  );
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m?.[1] !== undefined) out[m[1]] = m[2] ?? '';
  }
  return out;
}

describe('.env.example (INTEGRATION-R2-09)', () => {
  it('lists exactly the names the server, payments and the other packages read', () => {
    const names = Object.keys(readExample()).sort();
    const expected = [...new Set([...CONFIG_KEYS, ...PAYMENTS_ENV_KEYS, ...OTHER_KEYS])].sort();
    expect(names).toEqual(expected);
  });

  it('boots the server config once the three required secrets are filled', () => {
    const r = parseConfig({
      ...readExample(),
      PUBLIC_URL: 'http://localhost:8080',
      TOKEN_SECRET: 'dev-secret',
      ADMIN_KEY: 'dev-admin-key',
    });
    expect(r).toMatchObject({ ok: true });
  });
});

describe('payments mode switch', () => {
  const env = {
    PUBLIC_URL: 'http://localhost:8080',
    TOKEN_SECRET: 'dev-secret',
    ADMIN_KEY: 'dev-admin-key',
  };

  it('refuses a PAYPAL_ENV that is not sandbox', () => {
    const r = parseConfig({ ...env, PAYPAL_ENV: 'live' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join('\n')).toContain('PAYPAL_ENV');
  });

  it('needs the PayPal credentials when PAYMENTS=sandbox', () => {
    const r = parseConfig({ ...env, PAYMENTS: 'sandbox' });
    expect(r.ok).toBe(false);
    const text = !r.ok ? r.errors.join('\n') : '';
    for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID']) {
      expect(text).toContain(key);
    }
  });

  it('never prints the PayPal secrets', () => {
    const r = parseConfig({
      ...env,
      PAYMENTS: 'sandbox',
      PAYPAL_CLIENT_ID: 'cid',
      PAYPAL_CLIENT_SECRET: 'csecret',
      PAYPAL_WEBHOOK_ID: 'wid',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const text = JSON.stringify(redactConfig(r.config));
      for (const secret of ['csecret', 'cid', 'wid']) expect(text).not.toContain(`"${secret}"`);
    }
  });
});
