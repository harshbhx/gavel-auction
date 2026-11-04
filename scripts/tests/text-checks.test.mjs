// T-QA-010: smart quote in a md file fails; banned-word fixture fails, clean text passes.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { checkFiles as checkAscii, findNonAscii } from '../check-ascii.mjs';
import {
  buildMatcher,
  checkFiles as checkBanned,
  loadWordList,
  parseWordList,
} from '../check-banned-words.mjs';
import { globToRegExp } from '../lib-text-check.mjs';

const SMART = String.fromCharCode(0x2019);
const EACUTE = String.fromCharCode(0xe9);

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'gavel-text-'));
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

describe('check-ascii', () => {
  it('flags a smart quote in a markdown file with its position', () => {
    const dir = tree({ 'a.md': `plain\nit${SMART}s here\n` });
    const hits = checkAscii(dir, ['a.md'], []);
    assert.deepEqual(hits, [{ file: 'a.md', line: 2, column: 3, code: 0x2019 }]);
  });

  it('passes ASCII text including tabs and carriage returns', () => {
    assert.deepEqual(findNonAscii('a\tb\r\nc'), []);
  });

  it('skips paths listed in the ignore globs and binary files', () => {
    const dir = tree({
      'fx/u.json': EACUTE,
      'img.png': Buffer.from([0xff, 0x00, 0xc3]).toString('latin1'),
    });
    assert.deepEqual(checkAscii(dir, ['fx/u.json', 'img.png'], [globToRegExp('fx/**')]), []);
  });
});

describe('check-banned-words', () => {
  const words = parseWordList('Foo Bar, bazword\n# comment\n');
  const matcher = buildMatcher(words);

  it('fails on a listed word and reports no word text', () => {
    const dir = tree({ 'a.md': 'ok line\nthis has a BazWord inside\n' });
    assert.deepEqual(checkBanned(dir, ['a.md'], matcher), [{ file: 'a.md', line: 2, column: 12 }]);
  });

  it('matches whole words only and passes clean text', () => {
    const dir = tree({ 'a.md': 'bazwords foo barn clean text\n' });
    assert.deepEqual(checkBanned(dir, ['a.md'], matcher), []);
  });

  it('reads the list from the environment and treats an empty list as unset', () => {
    assert.deepEqual(loadWordList('/nonexistent', { BANNED_WORDS: 'one,two' }), ['one', 'two']);
    assert.deepEqual(loadWordList('/nonexistent', {}), []);
    assert.equal(buildMatcher([]), undefined);
  });
});
