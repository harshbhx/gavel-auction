import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIVE_HOST, isChecked, scanText } from '../check-no-live-host.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

describe('check-no-live-host', () => {
  it('flags the live host', () => {
    assert.equal(scanText(`https://${LIVE_HOST}/v1`), true);
  });
  it('passes the sandbox host', () => {
    assert.equal(scanText('https://api-m.sandbox.paypal.com'), false);
  });
  it('skips docs and allow-listed files only', () => {
    assert.equal(isChecked('docs/specs/x.txt'), false);
    assert.equal(isChecked('packages/payments/test/guard.test.ts'), false);
    assert.equal(isChecked('packages/web/src/app.ts'), true);
  });
  it('passes on the current tree', () => {
    const r = spawnSync('node', [join(root, 'scripts', 'check-no-live-host.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
  });
});
