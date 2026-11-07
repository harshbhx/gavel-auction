// Issue 824 (R-QA-001, R-QA-004): every workspace package runs the root versions of the test,
// type and lint tools, so a package run and a root run use the same engine.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const TOOLS = [
  'vitest',
  '@vitest/coverage-v8',
  'typescript',
  'eslint',
  '@eslint/js',
  'typescript-eslint',
  '@typescript-eslint/parser',
  'fast-check',
];

const rootPkg = readJson(join(root, 'package.json'));
const rootVersions = { ...rootPkg.dependencies, ...rootPkg.devDependencies };
const packages = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join('packages', d.name))
  .filter((dir) => {
    try {
      readFileSync(join(root, dir, 'package.json'));
      return true;
    } catch {
      return false;
    }
  });

describe('tool versions match the root (issue 824)', () => {
  it('declares no tool at a version other than the root one', () => {
    const drift = [];
    for (const dir of packages) {
      const pkg = readJson(join(root, dir, 'package.json'));
      const declared = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const tool of TOOLS) {
        const want = rootVersions[tool];
        const got = declared[tool];
        if (got !== undefined && want !== undefined && got !== want) {
          drift.push(`${dir}: ${tool} ${got}, root ${want}`);
        }
      }
    }
    assert.deepEqual(drift, []);
  });

  it('keeps no second copy of a tool under a package in the lockfile', () => {
    const lock = readJson(join(root, 'package-lock.json'));
    const nested = Object.keys(lock.packages ?? {}).filter((key) =>
      TOOLS.some(
        (tool) => /^packages\/[^/]+\/node_modules\//.test(key) && key.endsWith(`/${tool}`),
      ),
    );
    assert.deepEqual(nested, []);
  });

  it('has no legacy eslintrc left once every package uses the flat config', () => {
    for (const dir of packages) {
      const names = readdirSync(join(root, dir));
      assert.equal(
        names.some((n) => n.startsWith('.eslintrc')),
        false,
        `${dir} still has an .eslintrc`,
      );
    }
  });
});
