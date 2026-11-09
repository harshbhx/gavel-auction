import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  findSensitive,
  mdTable,
  parseFlags,
  percentile,
  sha256,
  summarize,
  verdictLine,
  writeEvidence,
} from '../evidence/lib.mjs';

describe('percentile and summarize', () => {
  it('uses nearest rank', () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    assert.equal(percentile(xs, 50), 10);
    assert.equal(percentile(xs, 95), 19);
    assert.equal(percentile(xs, 99), 20);
    assert.equal(percentile([], 95), 0);
    assert.equal(percentile([7], 95), 7);
  });

  it('does not depend on input order and rounds to 0.01', () => {
    const s = summarize([3.014, 1, 2, 100.005]);
    assert.deepEqual(s, { count: 4, min: 1, p50: 2, p95: 100.01, p99: 100.01, max: 100.01 });
    assert.deepEqual(summarize([]), { count: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });

  it('keeps p99 below max only with a large enough sample', () => {
    const xs = Array.from({ length: 200 }, (_, i) => i + 1);
    const s = summarize(xs);
    assert.equal(s.p95, 190);
    assert.equal(s.p99, 198);
    assert.equal(s.max, 200);
  });
});

describe('formatting', () => {
  it('builds a verdict line that can be grepped', () => {
    assert.equal(verdictLine('X', 'PASS'), 'X VERDICT: PASS');
    assert.equal(verdictLine('X', 'FAIL', 'n=3'), 'X VERDICT: FAIL (n=3)');
  });

  it('escapes pipes in table cells', () => {
    const t = mdTable(['a', 'b'], [['x|y', 2]]);
    assert.equal(t.split('\n')[2], '| x\\|y | 2 |');
  });
});

describe('findSensitive', () => {
  it('flags tokens, long secrets and emails but not a sha256', () => {
    assert.deepEqual(findSensitive(`digest ${sha256('x')}`), []);
    assert.ok(findSensitive('Authorization: Bearer abcdefghijklmnop1234').length > 0);
    assert.ok(findSensitive('a'.repeat(50)).length > 0);
    assert.ok(findSensitive('buyer@example.com').length > 0);
    assert.deepEqual(findSensitive('p95 3010.04 ms, n=50'), []);
  });
});

describe('writeEvidence', () => {
  it('writes json, md and a matching sha256 file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ev-'));
    try {
      const digest = writeEvidence(dir, 'x', { a: 1 }, '# hi');
      const json = readFileSync(join(dir, 'x.json'), 'utf8');
      assert.equal(sha256(json), digest);
      assert.equal(readFileSync(join(dir, 'x.sha256'), 'utf8'), `${digest}  x.json\n`);
      assert.equal(readFileSync(join(dir, 'x.md'), 'utf8'), '# hi\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses evidence that holds an email', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ev-'));
    try {
      assert.throws(() => writeEvidence(dir, 'x', { who: 'a@b.co' }, '#'), /sensitive/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseFlags', () => {
  it('reads key value pairs and rejects a missing value', () => {
    assert.deepEqual(parseFlags(['--a', '1', '--b', 'x']), { a: '1', b: 'x' });
    assert.throws(() => parseFlags(['--a']), /needs a value/);
    assert.throws(() => parseFlags(['loose']), /unexpected/);
  });
});
