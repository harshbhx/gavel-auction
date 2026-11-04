import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkgDir = new URL('..', import.meta.url).pathname;

function run(script: string, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [join(pkgDir, 'scripts', script), ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? 1, out: err.stdout ?? '' };
  }
}

// Built without a literal call so the trace script does not read these samples as real titles.
const IT = 'i' + 't';
const sample = (...titles: string[]): string =>
  titles.map((t) => `${IT}(${JSON.stringify(t)}, () => {});\n`).join('');

function scratch(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'engine-check-'));
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

describe('package boundaries', () => {
  it('T-ENG-085 R-ENG-119 package.json declares no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(pkg['dependencies']).toBeUndefined();
    expect(run('check-imports.mjs', []).code).toBe(0);
  });

  it('T-ENG-085 R-ENG-119 R-ENG-120 the import check rejects node imports and dependencies', () => {
    const dir = scratch({
      'src/core.ts': "import { readFileSync } from 'node:fs';\nexport const x = readFileSync;\n",
      'src/node/io.ts': "import { readFileSync } from 'node:fs';\nexport const y = readFileSync;\n",
      'package.json': JSON.stringify({ dependencies: { left: '1.0.0' } }),
    });
    try {
      const r = run('check-imports.mjs', [
        '--src',
        join(dir, 'src'),
        '--package',
        join(dir, 'package.json'),
      ]);
      expect(r.code).toBe(1);
      expect(r.out).toContain('core.ts');
      expect(r.out).not.toContain('io.ts');
      expect(r.out).toContain('dependencies');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('trace check', () => {
  const spec = '- **R-ENG-001** one\n- **R-ENG-002** two\n';

  it('T-ENG-086 R-ENG-124 R-ENG-122 exits 1 on a seeded missing id and an untagged title', () => {
    const dir = scratch({
      'spec.md': spec,
      'tests/a.test.ts': sample('T-ENG-001 R-ENG-001 covered', 'no ids here'),
    });
    try {
      const r = run('trace-check.mjs', [
        '--spec',
        join(dir, 'spec.md'),
        '--tests',
        join(dir, 'tests'),
        '--baseline',
        'none',
      ]);
      expect(r.code).toBe(1);
      expect(r.out).toContain('R-ENG-002');
      expect(r.out).toContain('no ids here');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('T-ENG-086 R-ENG-124 passes when every id is named and every title is tagged', () => {
    const dir = scratch({
      'spec.md': spec,
      'tests/a.test.ts': sample('T-ENG-001 R-ENG-001 R-ENG-002 covered'),
    });
    try {
      const r = run('trace-check.mjs', [
        '--spec',
        join(dir, 'spec.md'),
        '--tests',
        join(dir, 'tests'),
        '--baseline',
        'none',
      ]);
      expect(r.code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('T-ENG-086 R-ENG-124 the repository tests have no gap outside the baseline', () => {
    expect(run('trace-check.mjs', []).code).toBe(0);
  });
});
