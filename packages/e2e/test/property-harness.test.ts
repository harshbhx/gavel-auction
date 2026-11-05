import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRegressions, propertyParams, regressionExamples } from '../src/property/harness';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gavel-reg-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const good = { seed: 7, path: [1, 2], property: 'suite > case', value: [42] };

describe('loadRegressions (R8-Q05)', () => {
  it('returns nothing for a missing folder', () => {
    expect(loadRegressions(join(dir, 'absent'))).toEqual([]);
  });

  it('loads a well formed entry', () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify(good));
    expect(loadRegressions(dir)).toEqual([good]);
  });

  it('throws on an entry of the wrong shape instead of skipping it', () => {
    writeFileSync(join(dir, 'typo.json'), JSON.stringify({ ...good, path: 'oops' }));
    expect(() => loadRegressions(dir)).toThrow(/typo\.json/);
  });

  it('throws on a file that is not JSON', () => {
    writeFileSync(join(dir, 'bad.json'), '{');
    expect(() => loadRegressions(dir)).toThrow(/bad\.json: not valid JSON/);
  });
});

describe('regression replay', () => {
  it('selects the stored arguments of one property', () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify(good));
    expect(regressionExamples(dir, 'suite > case')).toEqual([[42]]);
    expect(regressionExamples(dir, 'other')).toEqual([]);
  });

  it('runs a stored counterexample as an example before random values', () => {
    writeFileSync(
      join(dir, 'a.json'),
      JSON.stringify({
        ...good,
        property: 'regression replay > runs a stored counterexample as an example before random values',
        value: [123456789],
      }),
    );
    const seen: number[] = [];
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 }), (n) => {
        seen.push(n);
      }),
      propertyParams({ numRuns: 3 }, dir),
    );
    expect(seen[0]).toBe(123456789);
  });
});
