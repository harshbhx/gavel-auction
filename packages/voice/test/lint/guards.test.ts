import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const cwd = fileURLToPath(new URL('../..', import.meta.url));
const eslint = new ESLint({ cwd });

async function lint(code: string, filePath: string): Promise<string[]> {
  const [res] = await eslint.lintText(code, { filePath: `${cwd}/${filePath}` });
  return (res?.messages ?? []).map((m) => m.message);
}

describe('T-VOX-068 import guard (R-VOX-061)', () => {
  it('rejects value imports of engine and payments', async () => {
    expect(await lint("import { Auction } from '@gavel/engine';\n", 'src/types.ts')).toHaveLength(
      1,
    );
    expect(await lint("import { pay } from '@gavel/payments';\n", 'src/types.ts')).toHaveLength(1);
    expect(
      await lint("import { x } from '../../../packages/engine/src/index';\n", 'src/types.ts'),
    ).toHaveLength(1);
  });

  it('allows type-only imports', async () => {
    expect(
      await lint("import type { Auction } from '@gavel/engine';\n", 'src/types.ts'),
    ).toHaveLength(0);
  });
});

describe('determinism guard', () => {
  const zones = ['src/decide/x.ts', 'src/parser/x.ts', 'src/segment/x.ts', 'src/pipeline/x.ts'];
  it.each(zones)('rejects clock and randomness in %s', async (file) => {
    expect(await lint('const a = Date.now();\n', file)).toHaveLength(1);
    expect(await lint('const a = Math.random();\n', file)).toHaveLength(1);
    expect(await lint('const a = new Date();\n', file)).toHaveLength(1);
  });

  it('rejects other clocks, ids and re-exports in the pure zones', async () => {
    for (const code of [
      'const a = performance.now();\n',
      'const a = crypto.randomUUID();\n',
      "const a = Date['now']();\n",
      'const a = Date();\n',
      "export { mutate } from '@gavel/engine';\n",
    ]) {
      expect(await lint(code, 'src/parser/x.ts'), code).toHaveLength(1);
    }
    expect(await lint('const a = performance.now();\n', 'src/audio/x.ts')).toHaveLength(1);
  });

  it('allows them outside the pure zones', async () => {
    expect(await lint('const a = Date.now();\n', 'src/browser/x.ts')).toHaveLength(0);
  });
});
