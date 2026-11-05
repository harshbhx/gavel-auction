import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { check, specIds, testMap, testTitles } from '../../packages/server/scripts/trace-check.mjs';

const spec = [
  '- **R-RT-001** Ids are ULIDs.',
  '- **R-RT-002** Ids are monotonic.',
  '- **R-RT-003** Ports exist.',
  '- **T-RT-002** [unit] (R-RT-002) mint ids',
].join('\n');

describe('server trace-check', () => {
  it('extracts requirement ids and the test map from the spec', () => {
    assert.deepEqual(specIds(spec), ['R-RT-001', 'R-RT-002', 'R-RT-003']);
    assert.deepEqual([...testMap(spec)], [['T-RT-002', ['R-RT-002']]]);
  });

  it('reads describe, it and test titles', () => {
    const src = "describe('a (R-RT-001)', () => { it.skip(\"b\", f); test('c', f); });";
    assert.deepEqual(testTitles(src), ['a (R-RT-001)', 'b', 'c']);
  });

  it('counts ids named in a title, a file name, or through a T id', () => {
    const tests = [
      { file: 'a.test.ts', src: "it('works (R-RT-001)', () => {});" },
      { file: 'b.test.ts', src: "it('T-RT-002 mints', () => {});" },
    ];
    assert.deepEqual(check(spec, tests).uncovered, ['R-RT-003']);
    const byName = [{ file: 'R-RT-003.test.ts', src: '' }, ...tests];
    assert.deepEqual(check(spec, byName).uncovered, []);
  });

  it('fails on a new uncovered id but not on an allowed one', () => {
    assert.deepEqual(check(spec, [], { 'R-RT-001': 'x', 'R-RT-002': 'x' }).uncovered, ['R-RT-003']);
    assert.deepEqual(check(spec, [], { 'R-RT-001': 'x', 'R-RT-002': 'x', 'R-RT-003': 'x' }).uncovered, []);
  });

  it('reports stale allowlist entries', () => {
    const tests = [{ file: 'a.test.ts', src: "it('R-RT-001', f);" }];
    const r = check(spec, tests, { 'R-RT-001': 'x', 'R-RT-009': 'x' });
    assert.deepEqual(r.stale, ['R-RT-001', 'R-RT-009']);
  });
});
