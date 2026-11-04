import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scanSource } from '../check-engine-purity.mjs';

const labels = (src) => scanSource(src).map((h) => h.label);

describe('engine purity scan', () => {
  it('flags the direct clock and random sources', () => {
    assert.ok(labels('const t = Date.now();').includes('Date.now'));
    assert.ok(labels('const r = Math.random();').includes('Math.random'));
    assert.ok(labels('const d = new Date();').includes('new Date'));
  });

  it('flags the sources the first version missed', () => {
    assert.ok(labels('const t = performance.now();').includes('performance.now'));
    assert.ok(labels('const u = crypto.randomUUID();').includes('crypto random'));
    assert.ok(labels('crypto.getRandomValues(buf);').includes('crypto random'));
    assert.ok(labels('const s = Date();').includes('Date()'));
    assert.ok(labels("const n = Date['now']();").length > 0);
    assert.ok(labels('const { now } = Date;').includes('destructured clock or random'));
    assert.ok(labels("import { randomUUID } from 'node:crypto';").length > 0);
    assert.ok(labels('setTimeout(() => 1, 5);').includes('timer'));
  });

  it('is not defeated by a URL string before the call', () => {
    const src = "const u = 'http://x'; const t = Date.now();";
    assert.deepEqual(labels(src), ['Date.now']);
  });

  it('ignores comments and string contents', () => {
    assert.deepEqual(labels('// Date.now() is forbidden\nconst a = 1;'), []);
    assert.deepEqual(labels('/* Math.random() */ const a = 1;'), []);
    assert.deepEqual(labels("const s = 'Date.now()';"), []);
  });
});
