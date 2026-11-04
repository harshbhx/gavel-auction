// T-QA-029: each cross-check in the fixture validator rejects its own kind of edit.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseSpokenBid, validate } from '../check-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', '..', 'packages', 'e2e', 'fixtures');

function copyFixtures() {
  const dir = join(mkdtempSync(join(tmpdir(), 'fixtures-')), 'fixtures');
  cpSync(source, dir, { recursive: true });
  execFileSync(process.execPath, [join(dir, 'audio', 'generate.mjs')], { stdio: 'ignore' });
  return dir;
}

function edit(dir, file, change) {
  const path = join(dir, 'audio', file);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  change(json);
  writeFileSync(path, JSON.stringify(json, null, 2));
}

describe('fixture validator', () => {
  let pristine;
  before(() => {
    pristine = validate(copyFixtures());
  });

  it('accepts the committed fixtures', () => {
    assert.deepEqual(pristine.errors, []);
  });

  it('rejects an expected amount that disagrees with the spoken amount', () => {
    const dir = copyFixtures();
    edit(dir, 'bid-clear-001.json', (j) => {
      j.expected.amountCents = 50000;
    });
    assert.ok(validate(dir).errors.some((e) => /disagrees with the spoken amount/.test(e)));
  });

  it('rejects an expected bidder that is not the spoken bidder', () => {
    const dir = copyFixtures();
    edit(dir, 'bid-clear-001.json', (j) => {
      j.expected.bidder = '99';
    });
    assert.ok(validate(dir).errors.some((e) => /disagrees with the spoken bidder/.test(e)));
  });

  it('rejects an STT transcript that differs from the ground truth', () => {
    const dir = copyFixtures();
    edit(dir, 'bid-clear-001.stt.json', (j) => {
      j.transcript = 'three hundred for paddle thirteen';
    });
    assert.ok(validate(dir).errors.some((e) => /differs from transcriptTruth/.test(e)));
  });

  it('rejects STT words that do not spell the transcript', () => {
    const dir = copyFixtures();
    edit(dir, 'bid-clear-001.stt.json', (j) => {
      j.words[0].word = 'tree';
    });
    assert.ok(validate(dir).errors.some((e) => /do not spell the transcript/.test(e)));
  });

  it('rejects candidates that omit the expected amount', () => {
    const dir = copyFixtures();
    edit(dir, 'bid-ambiguous-004.json', (j) => {
      j.expected.candidates = [1500, 2500];
    });
    assert.ok(validate(dir).errors.some((e) => /candidates must include/.test(e)));
  });
});

describe('parseSpokenBid', () => {
  it('reads colloquial and corrected bids', () => {
    assert.deepEqual(parseSpokenBid('one fifty for paddle eighteen'), {
      amountCents: 15000,
      bidder: '18',
    });
    assert.deepEqual(parseSpokenBid('four twenty five for paddle one'), {
      amountCents: 42500,
      bidder: '1',
    });
    assert.deepEqual(parseSpokenBid('three hundred no wait three fifty for paddle twelve'), {
      amountCents: 35000,
      bidder: '12',
    });
  });
});
