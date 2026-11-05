// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { en } from '../../src/copy/en';
import { HOLD_ERROR_CODES } from '@gavel/shared';
import {
  KNOWN_ERROR_CODES,
  errorCopy,
  errorCopyTable,
  holdErrorCopyTable,
} from '../../src/copy/errors';

function sharedCodes(): string[] {
  const text = readFileSync(
    new URL('../../../shared/src/errors.ts', import.meta.url).pathname,
    'utf8',
  );
  const block = /ERROR_CODES\s*=\s*\[([^\]]*)\]/.exec(text)?.[1] ?? '';
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? '');
}

describe('error code table (T-WEB-007)', () => {
  it('covers every code exported by shared', () => {
    expect([...KNOWN_ERROR_CODES].sort()).toEqual(sharedCodes().sort());
  });

  it('maps every code to an existing copy key', () => {
    for (const code of KNOWN_ERROR_CODES) {
      const { key, raw } = errorCopy(code);
      expect(key in en, code).toBe(true);
      expect(raw).toBe(code);
      expect(errorCopyTable[code]).toBe(key);
    }
  });

  it('maps every payments error code to its own copy key', () => {
    for (const code of HOLD_ERROR_CODES) {
      const { key, raw } = errorCopy(code);
      expect(key in en, code).toBe(true);
      expect(key).toBe(holdErrorCopyTable[code]);
      expect(key).not.toBe('bid.rej.generic');
      expect(raw).toBe(code);
    }
  });

  it('maps the bid rejection codes to their messages', () => {
    expect(errorCopy('over_ceiling').key).toBe('bid.rej.over_ceiling');
    expect(errorCopy('below_increment').key).toBe('bid.rej.below_increment');
    expect(errorCopy('closed').key).toBe('bid.rej.closed');
  });

  it('maps an unknown code to the generic message and keeps the raw code', () => {
    expect(errorCopy('martian_interference')).toEqual({
      key: 'bid.rej.generic',
      raw: 'martian_interference',
    });
    expect(errorCopy('constructor').key).toBe('bid.rej.generic');
  });
});
