import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { touchesCode } from '../classify-change.mjs';

describe('classify-change', () => {
  it('treats plain documentation as docs-only', () => {
    assert.equal(touchesCode(['docs/a.md', 'CHANGELOG.md']), false);
  });

  it('counts a move from source into docs as code (both paths listed)', () => {
    assert.equal(touchesCode(['packages/engine/src/x.ts', 'docs/x.md']), true);
  });

  it('counts evidence files and gate or decision logs as code', () => {
    assert.equal(touchesCode(['docs/evidence/run-1.json']), true);
    assert.equal(touchesCode(['docs/GATES.md']), true);
    assert.equal(touchesCode(['docs/DECISIONS.md']), true);
  });

  it('counts the docs that unit tests assert on as code', () => {
    for (const f of ['README.md', 'SECURITY.md', 'docs/DEMO.md']) {
      assert.equal(touchesCode([f]), true, f);
    }
    assert.equal(touchesCode(['docs/a.md']), false);
  });

  it('counts an empty list as code', () => {
    assert.equal(touchesCode(['']), true);
  });
});
