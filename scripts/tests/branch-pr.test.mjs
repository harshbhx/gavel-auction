// T-QA-005: valid, missing key, wrong case.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validate } from '../check-branch-pr.mjs';
import { parseKey } from '../check-ownership.mjs';

describe('check-branch-pr', () => {
  it('accepts a valid branch and title', () => {
    assert.deepEqual(validate('feat/ENG-04-ledger-model', 'ENG-04: append-only ledger model'), []);
  });

  it('accepts extra keys after the first in the title', () => {
    assert.deepEqual(validate('chore/QA-04-hooks', 'QA-04 QA-05 QA-11: hooks and checks'), []);
  });

  it('accepts three digit keys such as PAY-100 in branch and title', () => {
    assert.deepEqual(validate('feat/PAY-100-hold-flow', 'PAY-100: hold flow'), []);
  });

  it('parses three digit keys for the ownership check', () => {
    assert.equal(parseKey('PAY-100: hold flow'), 'PAY-100');
    assert.equal(parseKey('[ENG-04] x'), 'ENG-04');
  });

  it('rejects a branch without a key', () => {
    assert.equal(validate('feat/ledger-model', 'ENG-04: ledger').length, 1);
  });

  it('rejects wrong case in the branch key or slug', () => {
    assert.equal(validate('feat/eng-04-ledger', 'ENG-04: ledger').length, 1);
    assert.equal(validate('feat/ENG-04-Ledger', 'ENG-04: ledger').length, 1);
    assert.equal(validate('Feat/ENG-04-ledger', 'ENG-04: ledger').length, 1);
  });

  it('rejects a title that lacks the key or uses another one', () => {
    assert.equal(validate('feat/ENG-04-ledger', 'append-only ledger').length, 1);
    assert.equal(validate('feat/ENG-04-ledger', 'ENG-05: ledger').length, 1);
    assert.equal(validate('feat/ENG-04-ledger', 'eng-04: ledger').length, 1);
  });
});
