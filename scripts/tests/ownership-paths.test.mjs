// Every path in the ownership map and in CODEOWNERS must match a tracked file.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { globToRegExp } from '../check-ownership.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
// Paths that belong to later work and have no tracked file yet.
const PLANNED = new Set(['infra/**', 'CONTRIBUTING.md']);

describe('ownership paths', () => {
  it('every ownership map glob matches a tracked file', () => {
    const map = JSON.parse(readFileSync(join(root, 'scripts', 'ownership.map.json'), 'utf8'));
    const dead = [];
    for (const [area, globs] of Object.entries(map.areas)) {
      for (const g of globs) {
        if (PLANNED.has(g)) continue;
        if (!files.some((f) => globToRegExp(g).test(f))) dead.push(`${area}: ${g}`);
      }
    }
    assert.deepEqual(dead, []);
  });

  it('every CODEOWNERS pattern matches a tracked file', () => {
    const lines = readFileSync(join(root, '.github', 'CODEOWNERS'), 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.startsWith('#'));
    const dead = [];
    for (const line of lines) {
      const [first, ...rest] = line.trim().split(/\s+/);
      const patterns = rest.some((r) => r.startsWith('@'))
        ? [first, ...rest.filter((r) => !r.startsWith('@'))]
        : [first];
      for (const pattern of patterns) {
        const prefix = pattern.replace(/^\//, '');
        const hit = pattern.endsWith('/')
          ? files.some((f) => f.startsWith(prefix))
          : files.includes(prefix);
        if (!hit) dead.push(pattern);
      }
    }
    assert.deepEqual(dead, []);
  });
});

describe('CODEOWNERS syntax', () => {
  it('has one pattern and only @owners on every line', () => {
    const lines = readFileSync(join(root, '.github', 'CODEOWNERS'), 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.startsWith('#'));
    const bad = lines.filter((l) => !/^\/\S+\s+(@[\w-]+(\/[\w-]+)?\s*)+$/.test(l.trim() + ' '));
    assert.deepEqual(bad, []);
  });
});
