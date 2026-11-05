import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findNodeModulesPaths } from '../check-no-tracked-node-modules.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('tracked node_modules guard', () => {
  it('flags a node_modules segment at any depth', () => {
    assert.deepEqual(
      findNodeModulesPaths([
        'docs/node_modules/x.env',
        'packages/foo/node_modules/secret.txt',
        'node_modules/a',
        'src/index.ts',
        'docs/my_node_modules_notes.md',
      ]),
      ['docs/node_modules/x.env', 'packages/foo/node_modules/secret.txt', 'node_modules/a'],
    );
  });

  it('keeps node_modules out of the gitleaks allowlist', () => {
    const toml = readFileSync(join(root, '.gitleaks.toml'), 'utf8');
    assert.equal(toml.includes('node_modules/'), false);
  });
});
