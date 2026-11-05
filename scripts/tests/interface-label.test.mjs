import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluate } from '../check-interface-label.mjs';

describe('interface label policy', () => {
  it('passes when no report changed', () => {
    assert.equal(evaluate([], []).ok, true);
  });

  it('fails an export change without the label', () => {
    const v = evaluate(['etc/engine.api.md'], ['area:engine']);
    assert.equal(v.ok, false);
  });

  it('passes an export change with the label', () => {
    assert.equal(evaluate(['etc/engine.api.md'], ['Interface']).ok, true);
  });
});
