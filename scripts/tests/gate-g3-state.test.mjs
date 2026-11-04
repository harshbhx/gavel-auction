import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const wf = readFileSync(new URL('../../.github/workflows/gate-g3.yml', import.meta.url), 'utf8');

test('the probe state is restored only from main runs of this workflow', () => {
  assert.match(wf, /workflow_run\.head_branch == "main"/);
  assert.match(wf, /gate-g3\.yml/);
  assert.match(wf, /actions\/runs\/\$rid/);
  assert.doesNotMatch(wf, /per_page=1"/);
});

test('the restored state must match its keyed tag', () => {
  assert.match(wf, /state\.tag/);
  assert.match(wf, /openssl dgst -sha256 -hmac "\$G3_TAG_KEY"/);
  assert.match(wf, /Tag mismatch/);
});
