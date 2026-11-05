import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluate, simplifyBrands } from '../check-interface-label.mjs';

describe('brand spelling for the report', () => {
  it('turns a unique symbol key into a plain property', () => {
    const src =
      'declare const centsBrand: unique symbol;\nexport type Cents = number & {\n    readonly [centsBrand]: "Cents";\n};\n';
    const out = simplifyBrands(src);
    assert.equal(out.includes('unique symbol'), false);
    assert.equal(out.includes('__brand_centsBrand: "Cents"'), true);
  });
});

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
