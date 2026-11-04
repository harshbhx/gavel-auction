// T-QA-004: commitlint accepts a conventional message and rejects the others.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));

function lint(message) {
  const r = spawnSync('npx', ['--no-install', 'commitlint'], {
    cwd: root,
    input: message,
    encoding: 'utf8',
  });
  return r.status;
}

describe('commitlint config', () => {
  it('accepts feat(engine): add ledger', () => {
    assert.equal(lint('feat(engine): add ledger'), 0);
  });
  it('rejects a free-form message', () => {
    assert.notEqual(lint('Added stuff.'), 0);
  });
  it('rejects an 80 character subject', () => {
    assert.notEqual(lint(`feat(engine): ${'a'.repeat(66)}`), 0);
  });
  it('rejects an unknown scope and a trailing period', () => {
    assert.notEqual(lint('feat(billing): add ledger'), 0);
    assert.notEqual(lint('feat(engine): add ledger.'), 0);
  });
});
