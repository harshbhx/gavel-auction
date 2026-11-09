import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, validateEnv } from '../../src/config';

function without(env: Record<string, string>, name: string): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key !== name));
}

const good = {
  VITE_API_BASE: 'http://localhost:8787',
  VITE_WS_BASE: 'ws://localhost:8787',
  VITE_PAYPAL_CLIENT_ID: 'sandbox-client',
  VITE_SANDBOX: 'true',
  VITE_PAYMENTS: 'paypal',
};

describe('validateEnv', () => {
  it('accepts a complete sandbox configuration', () => {
    const result = validateEnv(good);
    expect(result).toEqual({
      ok: true,
      config: {
        apiBase: good.VITE_API_BASE,
        wsBase: good.VITE_WS_BASE,
        paypalClientId: good.VITE_PAYPAL_CLIENT_ID,
        sandbox: true,
        payments: 'paypal',
      },
    });
  });

  it('lists a missing VITE_API_BASE by name', () => {
    expect(validateEnv(without(good, 'VITE_API_BASE'))).toEqual({
      ok: false,
      missing: ['VITE_API_BASE'],
    });
  });

  it('requires VITE_SANDBOX to be exactly true', () => {
    expect(validateEnv({ ...good, VITE_SANDBOX: 'false' })).toEqual({
      ok: false,
      missing: ['VITE_SANDBOX'],
    });
  });

  it('does not need a PayPal client id with fake payments', () => {
    const env = { ...without(good, 'VITE_PAYPAL_CLIENT_ID'), VITE_PAYMENTS: 'fake' };
    expect(validateEnv(env).ok).toBe(true);
  });

  it('accepts https and wss hosts', () => {
    const env = {
      ...good,
      VITE_API_BASE: 'https://api.example.org',
      VITE_WS_BASE: 'wss://api.example.org',
    };
    expect(validateEnv(env).ok).toBe(true);
  });

  it('accepts plain http and ws only for a loopback host', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(
        validateEnv({
          ...good,
          VITE_API_BASE: `http://${host}:8787`,
          VITE_WS_BASE: `ws://${host}:8787`,
        }).ok,
      ).toBe(true);
    }
    expect(validateEnv({ ...good, VITE_API_BASE: 'http://api.example.org' })).toEqual({
      ok: false,
      missing: ['VITE_API_BASE'],
    });
    expect(validateEnv({ ...good, VITE_WS_BASE: 'ws://api.example.org' })).toEqual({
      ok: false,
      missing: ['VITE_WS_BASE'],
    });
  });

  it('rejects values that are not usable endpoints (WEB-RT-13)', () => {
    for (const bad of [
      'not a url',
      'ftp://api.example.org',
      'javascript:alert(1)',
      'https://user:pass@api.example.org',
      'http://localhost.evil.example',
    ]) {
      expect(validateEnv({ ...good, VITE_API_BASE: bad }), bad).toEqual({
        ok: false,
        missing: ['VITE_API_BASE'],
      });
    }
    expect(validateEnv({ ...good, VITE_WS_BASE: 'https://api.example.org' })).toEqual({
      ok: false,
      missing: ['VITE_WS_BASE'],
    });
  });

  it('rejects a PayPal client id that is not a single token', () => {
    for (const bad of ['has space', 'quote"id', 'a/b', '']) {
      expect(validateEnv({ ...good, VITE_PAYPAL_CLIENT_ID: bad }), bad).toEqual({
        ok: false,
        missing: ['VITE_PAYPAL_CLIENT_ID'],
      });
    }
  });

  it('rejects an unknown VITE_PAYMENTS value', () => {
    expect(validateEnv({ ...good, VITE_PAYMENTS: 'stripe' })).toEqual({
      ok: false,
      missing: ['VITE_PAYMENTS'],
    });
  });
});

describe('boot', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('fails with a readable message that names variables and never prints values', async () => {
    vi.stubEnv('VITE_API_BASE', '');
    vi.stubEnv('VITE_WS_BASE', 'ws://secret-host.invalid');
    vi.stubEnv('VITE_SANDBOX', 'true');
    vi.stubEnv('VITE_PAYMENTS', 'fake');
    vi.resetModules();
    const error: unknown = await import('../../src/config').then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('VITE_API_BASE');
    expect(message).not.toContain('secret-host');
  });

  it('exposes a frozen config when the environment is valid', async () => {
    for (const [name, value] of Object.entries(good)) vi.stubEnv(name, value);
    vi.resetModules();
    const mod = await import('../../src/config');
    expect(mod.config.apiBase).toBe(good.VITE_API_BASE);
    expect(Object.isFrozen(mod.config)).toBe(true);
    expect(new ConfigError(['X']).missing).toEqual(['X']);
  });
});

describe('packages/web/.env.example', () => {
  it('is a complete local configuration', () => {
    const text = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
    const env: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const m = /^(VITE_[A-Z_]+)=(.*)$/.exec(line);
      if (m?.[1] !== undefined) env[m[1]] = m[2] ?? '';
    }
    expect(validateEnv(env)).toMatchObject({ ok: true });
  });
});
