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
  emptyListOutcome,
  parseArgs,
  parseMetaArgs,
  checkPaths,
  checkText,
  checkCommits,
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

describe('text detection by content', () => {
  const bom = Buffer.from([0xff, 0xfe]);
  it('scans UTF-16 text with a byte order mark', () => {
    const dir = tree({ 'x.md': Buffer.concat([bom, Buffer.from(`it${SMART}s`, 'utf16le')]) });
    assert.equal(checkAscii(dir, ['x.md'], []).length, 1);
  });

  it('scans UTF-16 text without a byte order mark', () => {
    const dir = tree({ 'y.md': Buffer.from(`hello ${SMART} world`, 'utf16le') });
    assert.equal(checkAscii(dir, ['y.md'], []).length, 1);
  });

  it('scans printable text hidden under a media extension', () => {
    const dir = tree({ 'notes.png': `plain ${SMART} notes\n` });
    assert.equal(checkAscii(dir, ['notes.png'], []).length, 1);
  });

  it('scans a text file that holds one stray NUL byte', () => {
    const dir = tree({ 'z.md': `abc\0 ${SMART} def\n` });
    assert.equal(checkAscii(dir, ['z.md'], []).length, 1);
  });

  it('still skips real binary content under a media extension', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0xff, 0xfe, 0xc3, 0, 1, 2, 3]);
    const dir = tree({ 'real.png': bytes });
    assert.deepEqual(checkAscii(dir, ['real.png'], []), []);
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

describe('check-banned-words empty list', () => {
  it('fails in CI when no list is configured', () => {
    assert.equal(emptyListOutcome({ CI: 'true' }), 'fail');
    assert.equal(emptyListOutcome({ CI: 'true', BANNED_WORDS_ALLOW_EMPTY: 'false' }), 'fail');
  });

  it('skips locally and when CI explicitly allows an empty list', () => {
    assert.equal(emptyListOutcome({}), 'skip');
    assert.equal(emptyListOutcome({ CI: 'true', BANNED_WORDS_ALLOW_EMPTY: 'true' }), 'skip');
  });

  it('parses --root apart from file arguments', () => {
    assert.deepEqual(parseArgs(['--root', 'pr', 'a.md']), { target: 'pr', files: ['a.md'] });
  });
});

describe('check-banned-words beyond file contents', () => {
  const matcher = buildMatcher(['bazword']);

  it('flags a banned word in a file path and reports no text', () => {
    assert.deepEqual(
      checkPaths(['docs/ok.md', 'docs/BazWord-notes.md', 'src/bazword/a.ts'], matcher),
      [{ index: 1 }, { index: 2 }],
    );
    assert.deepEqual(checkPaths(['docs/ok.md', 'docs/bazwords.md'], matcher), []);
  });

  it('flags a banned word in free text with line and column', () => {
    assert.deepEqual(checkText('PR_BODY', 'fine\nwith BazWord here', matcher), [
      { label: 'PR_BODY', line: 2, column: 6 },
    ]);
    assert.deepEqual(checkText('PR_BODY', undefined, matcher), []);
    assert.deepEqual(checkText('PR_TITLE', 'PAY-01: clean title', matcher), []);
  });

  it('ignores a co-author trailer but still checks everything else', () => {
    const one = (msg) => checkCommits('.', 'a..b', matcher, () => `abc1234\u0001${msg}\0`);
    const hit = [{ commit: 'abc1234' }];
    const key = ['Co', 'authored', 'by'].join('-');
    const lower = key.toLowerCase();
    assert.deepEqual(one(`fix(repo): ok\n\n${key}: BazWord <x@y.z>\n`), []);
    assert.deepEqual(one(`fix(repo): ok\n\n${lower}: BazWord <x@y.z>\n`), []);
    assert.deepEqual(one('fix(repo): bazword in subject\n\nBody\n'), hit);
    assert.deepEqual(one('fix(repo): ok\n\nbazword in body\n'), hit);
    assert.deepEqual(one(`fix(repo): ok\n\nbazword in body\n\n${key}: BazWord <x@y.z>\n`), hit);
    assert.deepEqual(one('fix(repo): ok\n\nSigned-off-by: bazword <x@y.z>\n'), hit);
  });

  it('passes a clean history range and parses the options', () => {
    const run = () => 'ccc3333\u0001feat(repo): clean\n\0';
    assert.deepEqual(checkCommits('.', 'a..b', matcher, run), []);
    assert.deepEqual(parseMetaArgs(['--text', 'A', '--git-log', 'x..y', '--text', 'B']), {
      texts: ['A', 'B'],
      logs: ['x..y'],
    });
    assert.deepEqual(parseArgs(['--text', 'A', '--git-log', 'x..y', 'f.md']), {
      target: undefined,
      files: ['f.md'],
    });
  });

  it('reads a real git range without matching a clean history', () => {
    assert.deepEqual(checkCommits('.', '-1 HEAD', matcher), []);
  });
});
