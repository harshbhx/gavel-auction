import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLiveHosts } from '../check-no-live-host.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const LIVE_HOST = ['https://api-m', 'paypal', 'com'].join('.');

describe('check-no-live-host', () => {
  it('flags the live REST host', () => {
    assert.notEqual(findLiveHosts(`${LIVE_HOST}/v1`).length, 0);
  });
  it('passes the sandbox host', () => {
    assert.deepEqual(findLiveHosts('https://api-m.sandbox.paypal.com'), []);
  });
  it('passes on the current tree', () => {
    const r = spawnSync('node', [join(root, 'scripts', 'check-no-live-host.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
  });
});
