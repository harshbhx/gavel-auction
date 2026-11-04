import { describe, expect, it } from 'vitest';
import { loadConfig, PaymentsConfigError, redactedConfig } from '../src/config.js';

const base = { PAYPAL_ENV: 'sandbox', PAYPAL_CLIENT_ID: 'cid-123', PAYPAL_CLIENT_SECRET: 'sec-456', PAYPAL_WEBHOOK_ID: 'wh-789' };

describe('config', () => {
  it('applies defaults', () => {
    const c = loadConfig(base);
    expect(c.maxCeilingCents).toBe(25000);
    expect(c.holdMaxAgeMs).toBe(7200000);
    expect(c.baseUrl).toBe('https://api-m.sandbox.paypal.com');
    expect(c.fake).toBe(false);
  });

  it('parses overrides and rejects non-integers', () => {
    expect(loadConfig({ ...base, GAVEL_MAX_CEILING_CENTS: '100' }).maxCeilingCents).toBe(100);
    for (const bad of ['1.5', '-3', 'abc', '0']) {
      expect(() => loadConfig({ ...base, GAVEL_HOLD_MAX_AGE_MS: bad })).toThrow(PaymentsConfigError);
    }
  });

  it('missing client id is an error unless fake mode', () => {
    const { PAYPAL_CLIENT_ID: _omit, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow(PaymentsConfigError);
    expect(loadConfig({ ...rest, GAVEL_PAYMENTS_FAKE: '1' }).fake).toBe(true);
  });

  it('requires PAYPAL_ENV=sandbox', () => {
    expect(() => loadConfig({ ...base, PAYPAL_ENV: 'live' })).toThrow(/sandbox/);
  });

  it('redacted dump hides secrets', () => {
    const dump = JSON.stringify(redactedConfig(loadConfig(base)));
    for (const s of ['cid-123', 'sec-456', 'wh-789']) expect(dump).not.toContain(s);
    expect(dump).toContain('[REDACTED]');
  });
});
