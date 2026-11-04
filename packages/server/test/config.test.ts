import { describe, expect, it } from 'vitest';
import { REDACTED, loadConfig, parseConfig, redactConfig } from '../src/config';

const good = {
  PUBLIC_URL: 'https://gavel.example.com',
  TOKEN_SECRET: 'super-secret-token-value-0123456789',
  ADMIN_KEY: 'admin-key-value-0123456789',
};

describe('server config (T-RT-089)', () => {
  it('applies defaults', () => {
    const r = parseConfig(good);
    expect(r.ok && r.config).toMatchObject({
      PORT: 8080,
      NODE_ENV: 'development',
      STORE: 'memory',
      LOG_LEVEL: 'info',
      DEMO_MODE: false,
      ALLOW_MEMORY_STORE: false,
      RATE_BID_PER_S: 3,
      RATE_BID_BURST: 5,
      MAX_CONN_PER_ROOM: 500,
      MAX_BIDDERS_PER_ROOM: 200,
      MAX_ROOMS: 20,
      MAX_BIDS_PER_AUCTION: 5000,
      PAYMENTS: 'fake',
      CORS_ORIGINS: [],
    });
  });

  it('parses explicit values', () => {
    const r = parseConfig({
      ...good,
      PORT: '3000',
      NODE_ENV: 'production',
      STORE: 'postgres',
      DATABASE_URL: 'postgres://u:p@h/db',
      CORS_ORIGINS: 'https://a.example, https://b.example',
      DEMO_MODE: '1',
      MAX_ROOMS: '5',
    });
    expect(r.ok && r.config).toMatchObject({
      PORT: 3000,
      NODE_ENV: 'production',
      STORE: 'postgres',
      CORS_ORIGINS: ['https://a.example', 'https://b.example'],
      DEMO_MODE: true,
      MAX_ROOMS: 5,
    });
  });

  it('lists every error together', () => {
    const r = parseConfig({ PORT: 'abc', STORE: 'redis', DEMO_MODE: 'yes' });
    expect(r.ok).toBe(false);
    const errors = r.ok ? [] : r.errors;
    for (const key of ['PORT', 'STORE', 'DEMO_MODE', 'PUBLIC_URL', 'TOKEN_SECRET', 'ADMIN_KEY']) {
      expect(
        errors.some((e) => e.startsWith(`${key}:`)),
        key,
      ).toBe(true);
    }
    expect(errors.length).toBeGreaterThanOrEqual(6);
  });

  it('treats empty strings as unset', () => {
    const r = parseConfig({ ...good, PORT: '', TOKEN_SECRET_PREVIOUS: '' });
    expect(r.ok && r.config.PORT).toBe(8080);
  });

  it('exits with code 1 and prints all errors', () => {
    const lines: string[] = [];
    let code: number | undefined;
    const hooks = {
      error: (l: string) => lines.push(l),
      exit: (c: number): never => {
        code = c;
        throw new Error('exit');
      },
    };
    expect(() => loadConfig({ PORT: 'x' }, hooks)).toThrow('exit');
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('PORT:');
    expect(lines.join('\n')).toContain('TOKEN_SECRET:');
    expect(lines.join('\n')).toContain('ADMIN_KEY:');
  });

  it('returns the config on success without exiting', () => {
    const cfg = loadConfig(good, {
      error: () => undefined,
      exit: (): never => {
        throw new Error('should not exit');
      },
    });
    expect(cfg.PORT).toBe(8080);
  });

  it('redacts secrets in the dump', () => {
    const r = parseConfig({
      ...good,
      TOKEN_SECRET_PREVIOUS: 'previous-secret-value',
      DATABASE_URL: 'postgres://u:pw@h/db',
    });
    if (!r.ok) throw new Error('expected ok');
    const dump = redactConfig(r.config);
    expect(dump.TOKEN_SECRET).toBe(REDACTED);
    expect(dump.TOKEN_SECRET_PREVIOUS).toBe(REDACTED);
    expect(dump.ADMIN_KEY).toBe(REDACTED);
    expect(dump.DATABASE_URL).toBe(REDACTED);
    const text = JSON.stringify(dump);
    for (const secret of [good.TOKEN_SECRET, good.ADMIN_KEY, 'previous-secret-value', 'pw@h']) {
      expect(text).not.toContain(secret);
    }
    expect(dump.PUBLIC_URL).toBe(good.PUBLIC_URL);
  });
});
