import { describe, expect, it } from 'vitest';
import { REDACTED, loadConfig, parseConfig, redactConfig } from '../src/config';

const good = {
  PUBLIC_URL: 'http://localhost:8080',
  TOKEN_SECRET: 'super-secret-token-value-0123456789',
  ADMIN_KEY: 'admin-key-value-0123456789',
};

const paypal = {
  PAYPAL_CLIENT_ID: 'client-id-value',
  PAYPAL_CLIENT_SECRET: 'cs-val',
  PAYPAL_WEBHOOK_ID: 'webhook-id-value',
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
      PAYMENTS: 'sandbox',
      ...paypal,
      MAX_ROOMS: '5',
    });
    expect(r.ok && r.config).toMatchObject({
      PORT: 3000,
      NODE_ENV: 'production',
      STORE: 'postgres',
      CORS_ORIGINS: ['https://a.example', 'https://b.example'],
      DEMO_MODE: false,
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
      TOKEN_SECRET_PREVIOUS: 'previous-secret-value-0123456789-abcdef',
      DATABASE_URL: 'postgres://u:pw@h/db',
    });
    if (!r.ok) throw new Error('expected ok');
    const dump = redactConfig(r.config);
    expect(dump.TOKEN_SECRET).toBe(REDACTED);
    expect(dump.TOKEN_SECRET_PREVIOUS).toBe(REDACTED);
    expect(dump.ADMIN_KEY).toBe(REDACTED);
    expect(dump.DATABASE_URL).toBe(REDACTED);
    const text = JSON.stringify(dump);
    for (const secret of [
      good.TOKEN_SECRET,
      good.ADMIN_KEY,
      'previous-secret-value-0123456789-abcdef',
      'pw@h',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(dump.PUBLIC_URL).toBe(good.PUBLIC_URL);
  });
});

describe('production rules (R-RT-131)', () => {
  const prod = {
    ...good,
    NODE_ENV: 'production',
    STORE: 'postgres',
    DATABASE_URL: 'postgres://u:p@h/db',
    PAYMENTS: 'sandbox',
    ...paypal,
  };

  it('accepts a compliant production env', () => {
    expect(parseConfig(prod).ok).toBe(true);
  });

  it('rejects weak secrets, memory store, fake payments and demo mode', () => {
    const r = parseConfig({
      ...good,
      NODE_ENV: 'production',
      TOKEN_SECRET: 'a',
      ADMIN_KEY: 'a',
      DEMO_MODE: '1',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const text = r.errors.join('\n');
    for (const key of ['TOKEN_SECRET', 'ADMIN_KEY', 'STORE', 'PAYMENTS', 'DEMO_MODE']) {
      expect(text).toContain(key);
    }
  });

  it('requires an explicit absolute DATA_DIR for the file store (R6-A05)', () => {
    const file = { ...prod, STORE: 'file', DATABASE_URL: undefined };
    for (const dir of [undefined, '', 'data', './data']) {
      const r = parseConfig({ ...file, DATA_DIR: dir });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join('\n')).toContain('DATA_DIR');
    }
    expect(parseConfig({ ...file, DATA_DIR: '/var/lib/gavel' }).ok).toBe(true);
    expect(parseConfig({ ...good, STORE: 'file' }).ok).toBe(true);
  });

  it('allows the memory store only with ALLOW_MEMORY_STORE=1', () => {
    const base = { ...prod, STORE: 'memory', DATABASE_URL: undefined };
    expect(parseConfig(base).ok).toBe(false);
    expect(parseConfig({ ...base, ALLOW_MEMORY_STORE: '1' }).ok).toBe(true);
  });

  it('rejects a weak previous secret and postgres without DATABASE_URL', () => {
    expect(parseConfig({ ...prod, TOKEN_SECRET_PREVIOUS: 'short' }).ok).toBe(false);
    expect(parseConfig({ ...prod, DATABASE_URL: undefined }).ok).toBe(false);
  });

  it('keeps short secrets valid only under NODE_ENV=test', () => {
    expect(parseConfig({ ...good, NODE_ENV: 'test', TOKEN_SECRET: 'a', ADMIN_KEY: 'b' }).ok).toBe(
      true,
    );
    expect(parseConfig({ ...good, TOKEN_SECRET: 'a', ADMIN_KEY: 'b' }).ok).toBe(false);
  });

  it('rejects a token secret equal to the admin key', () => {
    const same = 'same-value-same-value-same-value-0123';
    const r = parseConfig({ ...good, TOKEN_SECRET: same, ADMIN_KEY: same });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.errors.join('\n')).toContain('ADMIN_KEY');
  });

  it('applies the production rules to a public https host with NODE_ENV unset (R4-W07)', () => {
    const r = parseConfig({
      ...good,
      PUBLIC_URL: 'https://gavel.example.com',
      TOKEN_SECRET: 'a',
      ADMIN_KEY: 'a',
      DEMO_MODE: '1',
    });
    expect(r.ok).toBe(false);
    const text = r.ok ? '' : r.errors.join('\n');
    for (const key of ['TOKEN_SECRET', 'ADMIN_KEY', 'STORE', 'PAYMENTS', 'DEMO_MODE']) {
      expect(text).toContain(key);
    }
    expect(parseConfig({ ...good, PUBLIC_URL: 'https://gavel.example.com' }).ok).toBe(false);
    expect(parseConfig({ ...good, PUBLIC_URL: 'https://localhost:8443' }).ok).toBe(true);
  });

  it('does not fall back to development rules on a public host without NODE_ENV', () => {
    const unset = { ...good, NODE_ENV: undefined, PUBLIC_URL: 'https://gavel.example.com' };
    const r = parseConfig({ ...unset, TOKEN_SECRET: 'a', ADMIN_KEY: 'a', DEMO_MODE: '1' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const text = r.errors.join('\n');
    for (const key of ['TOKEN_SECRET', 'ADMIN_KEY', 'STORE', 'PAYMENTS', 'DEMO_MODE']) {
      expect(text).toContain(key);
    }
  });

  it('keeps development rules for localhost without NODE_ENV', () => {
    const unset = { ...good, NODE_ENV: undefined };
    for (const host of ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080']) {
      const r = parseConfig({ ...unset, PUBLIC_URL: host, TOKEN_SECRET: 'a', ADMIN_KEY: 'a' });
      expect(r.ok && r.config.NODE_ENV).toBe('development');
    }
  });

  it('defaults the per-bidder connection cap to 3', () => {
    const r = parseConfig(good);
    expect(r.ok && r.config.MAX_CONN_PER_BIDDER).toBe(3);
  });
});

describe('secret rules under NODE_ENV=test (R7S-05)', () => {
  const short = { TOKEN_SECRET: 'a', ADMIN_KEY: 'b' };

  it('rejects NODE_ENV=test with a public https host', () => {
    const r = parseConfig({
      ...good,
      ...short,
      NODE_ENV: 'test',
      PUBLIC_URL: 'https://real.example',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join('\n')).toMatch(/NODE_ENV/);
      expect(r.errors.join('\n')).toMatch(/TOKEN_SECRET/);
    }
  });

  it('still allows short secrets for NODE_ENV=test on a local host', () => {
    expect(parseConfig({ ...good, ...short, NODE_ENV: 'test' }).ok).toBe(true);
  });
});
