import { describe, expect, it } from 'vitest';
import { AFTER_CAPTURE_KEYS, en, type CopyKey } from '../../src/copy/en';
import { t } from '../../src/copy/t';

describe('copy catalog', () => {
  it('returns plain strings unchanged', () => {
    expect(t('app.name')).toBe('GAVEL');
    expect(t('banner.sandbox')).toBe('Sandbox: no real money moves');
  });

  it('interpolates every placeholder', () => {
    expect(t('confirm.title', { amount: '$5.00', n: 12 })).toBe(
      'Did you mean $5.00 for paddle 12?',
    );
    expect(t('bid.plus', { amount: '$5.00' })).toBe('+$5.00');
    expect(t('ladder.invariants.ok', { c: '$1', r: '$2', h: '$3' })).toBe(
      'Totals check out: charged $1 + released $2 = holds $3',
    );
  });

  it('turns a missing param into a compile error', () => {
    // Never called: these lines exist so the type checker proves the errors.
    const compileOnly = (): void => {
      // @ts-expect-error params are required for keys with placeholders
      t('confirm.title');
      // @ts-expect-error every placeholder must be supplied
      t('confirm.title', { n: 1 });
      // @ts-expect-error unknown keys are rejected
      t('no.such.key');
    };
    expect(compileOnly).toBeTypeOf('function');
  });

  it('leaves no placeholder behind when all params are given', () => {
    expect(t('screen.settleSummary', { c: 1, r: 4 })).toBe('1 charged, 4 released');
  });

  it('keeps the exact required phrase on the landing and the ceiling step', () => {
    expect(en['reg.heldNotCharged']).toBe('Held, not charged.');
    expect(en['landing.promise']).toContain('Held, not charged');
  });

  it('contains only well-formed placeholders and no exclamation marks or emoji', () => {
    for (const key of Object.keys(en) as CopyKey[]) {
      const text = en[key];
      expect(text.includes('!'), key).toBe(false);
      expect(/[^\x20-\x7e]/.test(text), key).toBe(false);
      expect(/\{[^A-Za-z0-9_}]|\{\}/.test(text), key).toBe(false);
    }
  });

  it('marks the receipt keys that are shown after capture', () => {
    expect([...AFTER_CAPTURE_KEYS].sort()).toEqual(['receipt.charged', 'receipt.fallback']);
  });
});
