// Submit gate helpers (issue 324): checklist rows, OWNER fields, links, secret file names, ancestry.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ancestorVerdict,
  extractLinks,
  findOwnerFields,
  openChecklistRows,
  npmrcHasToken,
  parseArgs,
  parseChecklist,
  renderSummary,
  suspiciousFiles,
} from '../check-submission.mjs';

const TABLE = [
  '| Done | Item | Owner | Note |',
  '| ---- | ---- | ----- | ---- |',
  '| [x]  | Repository public | repo owner | ok |',
  '| [ ]  | Video uploaded | video owner | not yet |',
  '| [ ]  | Reuse statement | Devpost owner | WAIVED: owner decided, see issue |',
].join('\n');

describe('check-submission', () => {
  it('finds checklist rows and leaves out header and separator', () => {
    const rows = parseChecklist(TABLE);
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => r.done),
      [true, false, false],
    );
  });

  it('reports only unchecked rows without a waiver', () => {
    const open = openChecklistRows(parseChecklist(TABLE));
    assert.deepEqual(
      open.map((r) => r.item),
      ['Video uploaded'],
    );
  });

  it('lists OWNER fields with line numbers', () => {
    const md = 'a\nOWNER: list the tools\nb\n| x | OWNER: state status |\n';
    const found = findOwnerFields(md);
    assert.deepEqual(
      found.map((f) => f.line),
      [2, 4],
    );
    assert.equal(findOwnerFields('the owner decides').length, 0);
  });

  it('extracts links and skips placeholders and local hosts', () => {
    const md =
      'See [a](https://example.org/x), https://github.com/o/r/blob/main/a.md. And http://localhost:3000/x, https://h.example.invalid/y, https://x.test/${id}.';
    assert.deepEqual(extractLinks(md), ['https://github.com/o/r/blob/main/a.md']);
  });

  it('flags env and key files but not examples or public keys', () => {
    const files = [
      '.env',
      '.env.example',
      'packages/a/.env.local',
      'keys/server.pem',
      'keys/ok.pub',
      'src/index.ts',
      'creds/credentials.json',
      '.env.sample',
    ];
    assert.deepEqual(suspiciousFiles(files), [
      '.env',
      'packages/a/.env.local',
      'keys/server.pem',
      'creds/credentials.json',
    ]);
  });

  it('flags an npmrc with a literal token only', () => {
    assert.equal(npmrcHasToken('ignore-scripts=true\n'), false);
    assert.equal(npmrcHasToken('//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n'), false);
    assert.equal(npmrcHasToken('//registry.npmjs.org/:_authToken=abc123\n'), true);
  });

  it('accepts main ahead or identical and rejects diverged or behind', () => {
    assert.equal(ancestorVerdict({ status: 'ahead', ahead_by: 4 }).ok, true);
    assert.equal(ancestorVerdict({ status: 'identical' }).ok, true);
    assert.equal(ancestorVerdict({ status: 'diverged' }).ok, false);
    assert.equal(ancestorVerdict({ status: 'behind' }).ok, false);
  });

  it('parses flags and rejects unknown ones', () => {
    const o = parseArgs(['--offline', '--strict-devpost', '--api', 'https://a.test/']);
    assert.equal(o.offline, true);
    assert.equal(o.strictDevpost, true);
    assert.equal(o.api, 'https://a.test');
    assert.throws(() => parseArgs(['--nope']));
  });

  it('renders READY only when nothing failed', () => {
    const ok = renderSummary([
      { name: 'a', status: 'PASS', detail: 'x' },
      { name: 'b', status: 'WARN', detail: 'y' },
    ]);
    assert.match(ok, /READY/);
    const bad = renderSummary([{ name: 'a', status: 'FAIL', detail: 'x', list: ['one'] }]);
    assert.match(bad, /NOT READY/);
    assert.match(bad, /- one/);
  });
});
