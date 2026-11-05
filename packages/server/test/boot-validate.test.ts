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
      const env: Record<string, string | undefined> = goodEnv();
      delete env[name];
      const r = boot(env);
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
    const env = goodEnv();
    delete (env as Record<string, string | undefined>)['PAYPAL_WEBHOOK_ID'];
    const r = boot({ ...env, PAYPAL_ENV: 'live' });
    const text = r.lines.join('\n');
    for (const v of Object.values(env)) expect(text).not.toContain(v);
  });

  it('does not require the PayPal credentials when payments are fake', () => {
    const env: Record<string, string | undefined> = { ...goodEnv(), PAYMENTS: 'fake' };
    for (const k of REQUIRED_WITH_SANDBOX_PAYMENTS) delete env[k];
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
