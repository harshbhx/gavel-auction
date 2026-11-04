import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ENV_NAMES } from '../check-bundle-secrets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(root, 'scripts', 'check-bundle-secrets.mjs');
const run = (args, env = {}) =>
  spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

describe('check-bundle-secrets', () => {
  it('passes its own self test', () => {
    assert.equal(run(['--self-test']).status, 0);
  });

  it('fails when the bundle directory is required but missing', () => {
    assert.equal(run(['--require-dir', '--dir', join(tmpdir(), 'no-such-bundle')]).status, 1);
  });

  it('finds an inlined secret value that carries no variable name', () => {
    const dist = mkdtempSync(join(tmpdir(), 'dist-'));
    mkdirSync(join(dist, 'assets'));
    const value = `canary-${'k'.repeat(16)}`;
    writeFileSync(join(dist, 'assets', 'index.js'), `var a="${value}";`);
    const leaked = run(['--dir', dist, '--canaries-from-env'], { PAYPAL_CLIENT_SECRET: value });
    assert.equal(leaked.status, 1);
    assert.doesNotMatch(leaked.stderr, new RegExp(value));
    const clean = run(['--dir', dist, '--canaries-from-env'], {
      PAYPAL_CLIENT_SECRET: `canary-${'z'.repeat(16)}`,
    });
    assert.equal(clean.status, 0);
  });

  it('finds a token-like string in a bundle', () => {
    const dist = mkdtempSync(join(tmpdir(), 'dist-'));
    writeFileSync(join(dist, 'index.js'), `t="A21${'b'.repeat(34)}";`);
    assert.equal(run(['--dir', dist]).status, 1);
  });
});

describe('.env.example', () => {
  it('lists every secret name with an empty value and is not ignored', () => {
    const path = join(root, '.env.example');
    assert.ok(existsSync(path), '.env.example must exist');
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.startsWith('#'));
    const values = new Map(lines.map((l) => l.split('=')).map(([k, v]) => [k, v]));
    for (const name of ENV_NAMES) {
      assert.ok(values.has(name), `${name} missing from .env.example`);
      assert.equal(values.get(name), '', `${name} must have an empty value`);
    }
    const ignored = spawnSync('git', ['check-ignore', '-q', '.env.example'], { cwd: root });
    assert.equal(ignored.status, 1, '.env.example must not be gitignored');
  });
});
