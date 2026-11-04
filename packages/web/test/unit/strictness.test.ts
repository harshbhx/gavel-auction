// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('tsconfig', () => {
  const raw = readFileSync(new URL('../../tsconfig.json', import.meta.url), 'utf8');
  const options = (JSON.parse(raw) as { compilerOptions: Record<string, unknown> }).compilerOptions;

  it('enables strict and noUncheckedIndexedAccess', () => {
    expect(options['strict']).toBe(true);
    expect(options['noUncheckedIndexedAccess']).toBe(true);
  });
});
