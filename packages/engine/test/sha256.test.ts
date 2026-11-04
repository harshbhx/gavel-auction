import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { utf8 } from '../src/hasher.js';
import { pureHasher } from '../src/sha256.js';

describe('pureHasher', () => {
  it('T-ENG-054 (R-ENG-079): NIST vectors', () => {
    const h = (s: string) => pureHasher.sha256Hex(utf8(s));
    expect(h('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(h('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(h('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(pureHasher.sha256Hex(new Uint8Array(1_000_000).fill(0x61))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });
  it('T-ENG-054 (R-ENG-079): implementation imports no node built-ins', () => {
    for (const f of ['sha256.ts', 'hasher.ts']) {
      const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
      expect(src).not.toMatch(/node:/);
    }
  });
});
