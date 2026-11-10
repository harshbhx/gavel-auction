import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { TestProjectInlineConfiguration } from 'vitest/config';

// One runner config for every package (R-QA-021). Each package that has a test directory
// contributes a `unit:<pkg>` project and a `property:<pkg>` project (files named
// *.property.test.ts). A package keeps its own vitest.config.ts for environment and setup files.
// Vitest 4 removed vitest.workspace.ts, so the projects live in `test.projects` below, next to the
// settings that only apply at the root, namely coverage (consumed by scripts/check-coverage.mjs).
const PACKAGES = ['shared', 'engine', 'payments', 'voice', 'server', 'web', 'e2e'] as const;

const rootDir = fileURLToPath(new URL('.', import.meta.url));

function project(
  pkg: string,
  kind: 'unit' | 'property',
  base: string | undefined,
): TestProjectInlineConfiguration {
  return {
    ...(base ? { extends: base } : {}),
    test: {
      name: `${kind}:${pkg}`,
      root: join(rootDir, 'packages', pkg),
      include: kind === 'unit' ? ['test/**/*.test.{ts,tsx}'] : ['test/**/*.property.test.{ts,tsx}'],
      exclude:
        kind === 'unit'
          ? ['test/**/*.property.test.{ts,tsx}', '**/node_modules/**']
          : ['**/node_modules/**'],
    },
  };
}

const projects: TestProjectInlineConfiguration[] = [];
for (const pkg of PACKAGES) {
  if (!existsSync(join(rootDir, 'packages', pkg, 'test'))) continue;
  const own = join(rootDir, 'packages', pkg, 'vitest.config.ts');
  const vite = join(rootDir, 'packages', pkg, 'vite.config.ts');
  const base = existsSync(own) ? own : existsSync(vite) ? vite : undefined;
  projects.push(project(pkg, 'unit', base), project(pkg, 'property', base));
}

export default defineConfig({
  test: {
    projects,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['json-summary', 'text-summary'],
      include: ['packages/*/src/**/*.{ts,tsx}'],
      // Only pure re-export barrels are excluded; index.ts files that hold logic stay counted.
      exclude: [
        '**/*.d.ts',
        '**/testing/**',
        'packages/e2e/src/index.ts',
        'packages/engine/src/index.ts',
        'packages/payments/src/index.ts',
        'packages/payments/src/bridge/index.ts',
        'packages/server/src/index.ts',
        'packages/server/src/runtime/index.ts',
        'packages/shared/src/index.ts',
        'packages/voice/src/index.ts',
        'packages/web/src/design/icons/index.ts',
      ],
    },
  },
});
