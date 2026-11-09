import { describe, expect, it } from 'vitest';
import { loadConfig, PaymentsConfigError, redactedConfig } from '../src/config.js';

const base = {
  PAYPAL_ENV: 'sandbox',
  PAYPAL_CLIENT_ID: 'cid-123',
  PAYPAL_CLIENT_SECRET: 'sec-456',
  PAYPAL_WEBHOOK_ID: 'wh-789',
};

describe('config', () => {
  it('applies defaults', () => {
    const c = loadConfig(base);
    expect(c.maxCeilingCents).toBe(100000);
    expect(c.holdMaxAgeMs).toBe(7200000);
    expect(c.baseUrl).toBe('https://api-m.sandbox.paypal.com');
    expect(c.fake).toBe(false);
  });

  it('parses overrides and rejects non-integers', () => {
    expect(loadConfig({ ...base, GAVEL_MAX_CEILING_CENTS: '100' }).maxCeilingCents).toBe(100);
    for (const bad of ['1.5', '-3', 'abc', '0']) {
      expect(() => loadConfig({ ...base, GAVEL_HOLD_MAX_AGE_MS: bad })).toThrow(
        PaymentsConfigError,
      );
    }
  });

  it('keeps GAVEL_MAX_CEILING_CENTS in the range the engine can run (FIX-118)', () => {
    for (const bad of ['50', '99', '100000001', '200000000']) {
      expect(() => loadConfig({ ...base, GAVEL_MAX_CEILING_CENTS: bad })).toThrow(
        /GAVEL_MAX_CEILING_CENTS must be an integer in 100\.\.100000000/,
      );
    }
    expect(loadConfig({ ...base, GAVEL_MAX_CEILING_CENTS: '100' }).maxCeilingCents).toBe(100);
    expect(loadConfig({ ...base, GAVEL_MAX_CEILING_CENTS: '100000000' }).maxCeilingCents).toBe(
      100_000_000,
    );
  });

  it('missing client id is an error unless fake mode', () => {
    const rest: Record<string, string | undefined> = { ...base };
    delete rest.PAYPAL_CLIENT_ID;
    expect(() => loadConfig(rest)).toThrow(PaymentsConfigError);
    expect(loadConfig({ ...rest, GAVEL_PAYMENTS_FAKE: '1' }).fake).toBe(true);
  });

  it('requires PAYPAL_WEBHOOK_ID outside fake mode', () => {
    const rest: Record<string, string | undefined> = { ...base };
    delete rest.PAYPAL_WEBHOOK_ID;
    expect(() => loadConfig(rest)).toThrow(/PAYPAL_WEBHOOK_ID is required/);
    expect(() => loadConfig({ ...rest, PAYPAL_WEBHOOK_ID: '' })).toThrow(PaymentsConfigError);
    expect(loadConfig({ ...rest, GAVEL_PAYMENTS_FAKE: '1' }).webhookId).toBe('');
    expect(loadConfig(rest, { requireWebhookId: false }).webhookId).toBe('');
  });

  it('requires PAYPAL_ENV=sandbox', () => {
    expect(() => loadConfig({ ...base, PAYPAL_ENV: 'live' })).toThrow(/sandbox/);
  });

  it('redacted dump hides secrets', () => {
    const dump = JSON.stringify(redactedConfig(loadConfig(base)));
    for (const s of ['cid-123', 'sec-456', 'wh-789']) expect(dump).not.toContain(s);
    expect(dump).toContain('[REDACTED]');
  });

  it('takes fake mode from the argument before the environment variable', () => {
    expect(loadConfig({ ...base, GAVEL_PAYMENTS_FAKE: '1' }, { fake: false }).fake).toBe(false);
    expect(loadConfig({ PAYPAL_ENV: 'sandbox' }, { fake: true }).fake).toBe(true);
  });
});
