import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config';

// Test-only constants, built at run time.
const ADMIN = 'admin-key-value-0123456789-abcd';
const JUDGE = ['test', 'judge', 'k'.repeat(32)].join('-');
const good = {
  PUBLIC_URL: 'http://localhost:8080',
  TOKEN_SECRET: 'super-secret-token-value-0123456789',
  ADMIN_KEY: ADMIN,
  JUDGE_ROOMS: 'true',
};

describe('JUDGE_KEY config', () => {
  it('is optional: unset and empty both mean no key', () => {
    for (const env of [good, { ...good, JUDGE_KEY: '' }]) {
      const r = parseConfig(env);
      expect(r.ok && r.config.JUDGE_KEY).toBeUndefined();
      expect(r.ok && r.config.JUDGE_KEY_ROOMS_MAX).toBe(10);
    }
  });

  it('accepts a long key with judge rooms on', () => {
    const r = parseConfig({ ...good, JUDGE_KEY: JUDGE, JUDGE_KEY_ROOMS_MAX: '2' });
    expect(r.ok && r.config.JUDGE_KEY).toBe(JUDGE);
    expect(r.ok && r.config.JUDGE_KEY_ROOMS_MAX).toBe(2);
  });

  it('refuses the operator key, the token secret, a short key and a key without judge rooms', () => {
    const bad = [
      { ...good, JUDGE_KEY: ADMIN },
      { ...good, JUDGE_KEY: good.TOKEN_SECRET },
      { ...good, JUDGE_KEY: 'short-key' },
      { ...good, JUDGE_KEY: JUDGE, JUDGE_ROOMS: 'false' },
    ];
    for (const env of bad) {
      const r = parseConfig(env);
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain(JUDGE);
      expect(JSON.stringify(r)).not.toContain(ADMIN);
    }
  });

  it('caps the keyed room bound at 50', () => {
    expect(parseConfig({ ...good, JUDGE_KEY: JUDGE, JUDGE_KEY_ROOMS_MAX: '51' }).ok).toBe(false);
  });

  it('does not refuse boot over a bad JUDGE_KEYS entry (boot skips and logs it)', () => {
    const r = parseConfig({ ...good, JUDGE_KEYS: JSON.stringify([{ id: 'x' }, 'nope']) });
    expect(r.ok).toBe(true);
    expect(parseConfig({ ...good, JUDGE_KEYS: 'not json' }).ok).toBe(true);
    expect(parseConfig({ ...good, JUDGE_ROOMS: 'false', JUDGE_KEYS: '[]' }).ok).toBe(false);
  });
});
