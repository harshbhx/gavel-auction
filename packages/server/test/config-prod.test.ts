import { describe, expect, it } from 'vitest';
import { productionGuardErrors, type ProdGuardInput } from '../src/config-prod';

const good: ProdGuardInput = {
  NODE_ENV: 'production',
  TOKEN_SECRET: 'x'.repeat(32),
  ADMIN_KEY: 'k'.repeat(24),
  STORE: 'postgres',
  ALLOW_MEMORY_STORE: false,
};

describe('production config guards (T-RT-090)', () => {
  it('passes a compliant production config', () => {
    expect(productionGuardErrors(good)).toEqual([]);
  });

  it('fails a 16-byte secret and names the field without echoing it', () => {
    const errors = productionGuardErrors({ ...good, TOKEN_SECRET: 's'.repeat(16) });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('TOKEN_SECRET');
    expect(errors[0]).not.toContain('ssss');
  });

  it('counts bytes, not characters', () => {
    // 16 two-byte characters are 32 bytes.
    expect(
      productionGuardErrors({ ...good, TOKEN_SECRET: String.fromCharCode(0xe9).repeat(16) }),
    ).toEqual([]);
  });

  it('fails a short admin key', () => {
    expect(productionGuardErrors({ ...good, ADMIN_KEY: 'k'.repeat(23) })).toHaveLength(1);
  });

  it('fails the memory store without the override and passes with it', () => {
    const mem = { ...good, STORE: 'memory' };
    expect(productionGuardErrors(mem)).toHaveLength(1);
    expect(productionGuardErrors({ ...mem, ALLOW_MEMORY_STORE: true })).toEqual([]);
  });

  it('reports every problem together', () => {
    const errors = productionGuardErrors({
      ...good,
      TOKEN_SECRET: 's',
      ADMIN_KEY: 'k',
      STORE: 'memory',
    });
    expect(errors).toHaveLength(3);
  });

  it('applies no guards outside production', () => {
    expect(
      productionGuardErrors({
        ...good,
        NODE_ENV: 'development',
        TOKEN_SECRET: 's',
        STORE: 'memory',
      }),
    ).toEqual([]);
  });
});
