import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config';

const good = {
  PUBLIC_URL: 'http://localhost:8080',
  TOKEN_SECRET: 'super-secret-token-value-0123456789',
  ADMIN_KEY: 'admin-key-value-0123456789',
};
const prod = {
  ...good,
  NODE_ENV: 'production',
  STORE: 'postgres',
  DATABASE_URL: 'postgres://u:p@h/db',
  PAYMENTS: 'sandbox',
  PAYPAL_CLIENT_ID: 'client-id-value',
  PAYPAL_CLIENT_SECRET: 'cs-val',
  PAYPAL_WEBHOOK_ID: 'webhook-id-value',
};

describe('judge room config', () => {
  it('defaults to off with conservative limits', () => {
    const r = parseConfig(good);
    expect(r.ok && r.config).toMatchObject({
      JUDGE_ROOMS: false,
      JUDGE_ROOMS_PAUSED: false,
      JUDGE_ROOMS_MAX: 5,
      JUDGE_ROOM_TTL_MS: 1_800_000,
      JUDGE_ROOMS_PER_IP_HOUR: 4,
      JUDGE_ROOMS_PER_HOUR: 40,
    });
  });

  it('accepts true and 1', () => {
    for (const v of ['true', '1']) {
      const r = parseConfig({ ...good, JUDGE_ROOMS: v });
      expect(r.ok && r.config.JUDGE_ROOMS).toBe(true);
    }
  });

  it('refuses the flag on a production-like host with the fake adapter', () => {
    const r = parseConfig({ ...prod, PAYMENTS: 'fake', JUDGE_ROOMS: 'true' });
    expect(r.ok).toBe(false);
  });

  it('refuses the flag when the PayPal base URL is not the sandbox', () => {
    const r = parseConfig({
      ...prod,
      JUDGE_ROOMS: 'true',
      PAYPAL_BASE_URL: 'https://api-m.paypal.com',
    });
    expect(r.ok).toBe(false);
  });

  it('accepts the flag with sandbox PayPal on a production-like host', () => {
    const r = parseConfig({ ...prod, JUDGE_ROOMS: 'true' });
    expect(r.ok && r.config.JUDGE_ROOMS).toBe(true);
  });

  it('bounds the lifetime and the cap', () => {
    expect(parseConfig({ ...good, JUDGE_ROOM_TTL_MS: '99999999' }).ok).toBe(false);
    expect(parseConfig({ ...good, JUDGE_ROOMS_MAX: '500' }).ok).toBe(false);
  });

  it('still refuses DEMO_MODE in production', () => {
    expect(parseConfig({ ...prod, DEMO_MODE: '1', JUDGE_ROOMS: 'true' }).ok).toBe(false);
  });
});
