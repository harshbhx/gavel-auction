import { describe, expect, it } from 'vitest';
import { canonicalize, type JsonValue } from '../src/canonical.js';
import { EngineError } from '../src/errors.js';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof EngineError ? e.code : 'other';
  }
  return undefined;
}

describe('canonicalize', () => {
  it('T-ENG-053 (R-ENG-071): exact output and key order independence', () => {
    expect(canonicalize({ b: 1, a: [2, { d: 1, c: 2 }], e: '\u00e9' })).toBe(
      '{"a":[2,{"c":2,"d":1}],"b":1,"e":"\\u00e9"}',
    );
    expect(canonicalize({ x: 1, y: 2 })).toBe(canonicalize({ y: 2, x: 1 }));
  });
  it('T-ENG-053 (R-ENG-071): rejects non-canonical values', () => {
    for (const v of [1.5, -0, NaN, Infinity, undefined, '\ud800', 'a\udc00b']) {
      expect(code(() => canonicalize(v as unknown as JsonValue))).toBe('non_canonical');
    }
    expect(canonicalize('\u{1F600}')).toBe('"\\ud83d\\ude00"');
    expect(code(() => canonicalize({ a: undefined } as unknown as JsonValue))).toBe(
      'non_canonical',
    );
  });
  it('T-ENG-006 (R-ENG-006): forbidden keys fail without polluting prototypes', () => {
    expect(code(() => canonicalize({ constructor: 1 }))).toBe('non_canonical');
    expect(code(() => canonicalize({ prototype: 1 }))).toBe('non_canonical');
    expect(code(() => canonicalize(JSON.parse('{"__proto__":1}') as JsonValue))).toBe(
      'non_canonical',
    );
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
  it('R4-E08 R-ENG-071 golden vector: code point key order and ASCII-only escapes', () => {
    // U+FFFF sorts before U+1F600 by code point; UTF-16 order would put the astral key first.
    const v = { '\u{1F600}': 2, '\uffff': 1, '\u007f': 3 };
    expect(canonicalize(v)).toBe('{"\\u007f":3,"\\uffff":1,"\\ud83d\\ude00":2}');
  });
});
