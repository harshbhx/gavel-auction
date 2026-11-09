import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const script = join(root, 'scripts', 'ci', 'assert-live-host.sh');
const run = (...pairs) => spawnSync('bash', [script, ...pairs], { encoding: 'utf8' });

const ACCEPTED = [
  'https://gavel.dualmindlab.tech',
  'https://api.gavel.dualmindlab.tech',
  'https://docs.gavel.dualmindlab.tech',
  'https://gavel-web.creharsh.workers.dev',
  'https://gavel-web-preview.creharsh.workers.dev',
  'https://gavel-docs.creharsh.workers.dev',
  'https://gavel-auction-z2nm.onrender.com',
  'https://gavel-auction-z2nm.onrender.com/',
];

const REFUSED = [
  'https://example.com',
  'http://gavel.dualmindlab.tech',
  'https://gavel.dualmindlab.tech.evil.example',
  'https://evilgavel.dualmindlab.tech',
  'https://gavel.dualmindlab.tech@evil.example',
  'https://evil.example@gavel.dualmindlab.tech',
  'https://gavel.dualmindlab.tech:8443',
  'https://gavel.dualmindlab.tech/path',
  'https://gavel.dualmindlab.tech//',
  'https://x.gavel.dualmindlab.tech',
  'https://gavel-auction-z2nm.onrender.com.evil.example',
  'https://creharsh.workers.dev',
  'https://gavel.dualmindlab.tech\nhttps://evil.example',
  'https://*',
  '',
];

describe('assert-live-host.sh', () => {
  for (const url of ACCEPTED) {
    it(`accepts ${JSON.stringify(url)}`, () => {
      const r = run(`api_url=${url}`);
      assert.equal(r.status, 0, r.stderr);
    });
  }
  for (const url of REFUSED) {
    it(`refuses ${JSON.stringify(url)}`, () => {
      const r = run(`api_url=${url}`);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /Host not allowed/);
    });
  }
  it('refuses when any one of several pairs is bad', () => {
    const r = run('web_url=https://gavel.dualmindlab.tech', 'api_url=https://evil.example');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /api_url/);
  });
  it('refuses a call with no pairs', () => {
    assert.equal(run().status, 2);
  });
});

describe('live-traffic workflows use the shared allow-list', () => {
  for (const wf of [
    'evidence-hosted',
    'live-redteam',
    'live-stress',
    'ui-screens-live',
    'judge-smoke',
  ]) {
    it(`${wf}.yml calls assert-live-host.sh and has no shape-only regex`, () => {
      const text = readFileSync(join(root, '.github', 'workflows', `${wf}.yml`), 'utf8');
      assert.match(text, /scripts\/ci\/assert-live-host\.sh/);
      assert.doesNotMatch(text, /\^https:\/\/\[A-Za-z0-9\.-\]\+/);
    });
  }
});
