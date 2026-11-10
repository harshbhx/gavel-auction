import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

describe('gate entry scripts', () => {
  it('g1 run through vite-node prints a refusal and exits nonzero when secrets are missing', () => {
    const bin = require.resolve('vite-node/cli');
    const res = spawnSync(process.execPath, [bin, 'gates/g1.ts', '--', '--browser'], {
      cwd: pkgDir,
      encoding: 'utf8',
      env: { PATH: process.env['PATH'], HOME: process.env['HOME'] },
    });
    expect(res.stdout).toContain('refused: missing secret');
    expect(res.status).toBe(2);
  });

  it('g3 run through vite-node does not exit silently when secrets are missing', () => {
    const bin = require.resolve('vite-node/cli');
    const res = spawnSync(process.execPath, [bin, 'gates/g3.ts', '--', '--browser'], {
      cwd: pkgDir,
      encoding: 'utf8',
      env: { PATH: process.env['PATH'], HOME: process.env['HOME'] },
    });
    expect(res.stdout).toContain('refused: missing secret');
    expect(res.status).toBe(2);
  });

  it.each(['g1', 'g3', 'measure', 'idempotency'])('%s detects a vite-node entry run', (name) => {
    const src = readFileSync(join(pkgDir, 'gates', `${name}.ts`), 'utf8');
    expect(src).toContain("/vite-node/.test(process.argv[1] ?? '')");
  });
});
