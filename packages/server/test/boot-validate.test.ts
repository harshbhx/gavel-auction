import { describe, expect, it } from 'vitest';
import {
  EXIT_CONFIG,
  REQUIRED_ALWAYS,
  REQUIRED_WITH_SANDBOX_PAYMENTS,
  validateBootEnv,
} from '../src/config/validate';

// Values are built at run time so that no secret-looking literal sits in the repository.
const filler = 'x'.repeat(40);
const goodEnv = (): Record<string, string> => ({
  PUBLIC_URL: 'https://staging.example.test',
  TOKEN_SECRET: filler,
  ADMIN_KEY: 'a'.repeat(30),
  PAYMENTS: 'sandbox',
  PAYPAL_ENV: 'sandbox',
  PAYPAL_CLIENT_ID: 'id-' + 'y'.repeat(10),
  PAYPAL_CLIENT_SECRET: 's'.repeat(40),
  PAYPAL_WEBHOOK_ID: 'wh-' + 'z'.repeat(10),
});

function without(env: Record<string, string>, name: string): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([k]) => k !== name));
}

class Exited extends Error {
  constructor(public code: number) {
    super('exit');
  }
}

function boot(env: Record<string, string | undefined>): { code: number | null; lines: string[] } {
  const lines: string[] = [];
  try {
    validateBootEnv(env, {
      log: (l) => lines.push(l),
      exit: (code) => {
        throw new Exited(code);
      },
    });
  } catch (e) {
    if (e instanceof Exited) return { code: e.code, lines };
    throw e;
  }
  return { code: null, lines };
}

describe('boot validation (T-QA-080)', () => {
  it('lets a complete sandbox environment boot', () => {
    expect(boot(goodEnv())).toEqual({ code: null, lines: [] });
  });

  for (const name of [...REQUIRED_ALWAYS, ...REQUIRED_WITH_SANDBOX_PAYMENTS]) {
    it(`exits 78 naming only ${name} when it is removed`, () => {
      const r = boot(without(goodEnv(), name));
      expect(r.code).toBe(EXIT_CONFIG);
      expect(r.lines).toHaveLength(1);
      expect(JSON.parse(r.lines[0] as string)).toEqual({
        level: 'fatal',
        event: 'boot_config_invalid',
        variable: name,
        reason: 'missing',
      });
    });
  }

  it('treats an empty value as missing', () => {
    const r = boot({ ...goodEnv(), ADMIN_KEY: '  ' });
    expect(r.code).toBe(78);
    expect(r.lines).toHaveLength(1);
  });

  it('exits 78 when PAYPAL_ENV is not sandbox, without printing the value', () => {
    const r = boot({ ...goodEnv(), PAYPAL_ENV: 'live' });
    expect(r.code).toBe(78);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).not.toContain('live');
    expect(JSON.parse(r.lines[0] as string)).toMatchObject({
      variable: 'PAYPAL_ENV',
      reason: 'not_sandbox',
    });
  });

  it('never prints a value of the environment', () => {
    const env = without(goodEnv(), 'PAYPAL_WEBHOOK_ID');
    const r = boot({ ...env, PAYPAL_ENV: 'live' });
    const text = r.lines.join('\n');
    for (const name of ['TOKEN_SECRET', 'ADMIN_KEY', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']) {
      expect(text).not.toContain(env[name] as string);
    }
  });

  it('does not require the PayPal credentials when payments are fake', () => {
    const env = Object.fromEntries(
      Object.entries({ ...goodEnv(), PAYMENTS: 'fake' }).filter(
        ([k]) => !REQUIRED_WITH_SANDBOX_PAYMENTS.includes(k),
      ),
    );
    expect(boot(env).code).toBeNull();
  });

  it('reports every problem, one line each', () => {
    const r = boot({ ...goodEnv(), TOKEN_SECRET: undefined, PAYPAL_ENV: 'production' });
    expect(r.lines.map((l) => (JSON.parse(l) as { variable: string }).variable).sort()).toEqual([
      'PAYPAL_ENV',
      'TOKEN_SECRET',
    ]);
  });
});
