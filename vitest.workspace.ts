import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineWorkspace } from 'vitest/config';
import type { TestProjectInlineConfiguration } from 'vitest/config';

// One runner config for every package (R-QA-021). Each package that has a test directory
// contributes a `unit:<pkg>` project and a `property:<pkg>` project (files named
// *.property.test.ts). A package keeps its own vitest.config.ts for environment and setup files.
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
      include: kind === 'unit' ? ['test/**/*.test.ts'] : ['test/**/*.property.test.ts'],
      exclude:
        kind === 'unit'
          ? ['test/**/*.property.test.ts', '**/node_modules/**']
          : ['**/node_modules/**'],
    },
  };
}

const projects: TestProjectInlineConfiguration[] = [];
for (const pkg of PACKAGES) {
  if (!existsSync(join(rootDir, 'packages', pkg, 'test'))) continue;
  const own = join(rootDir, 'packages', pkg, 'vitest.config.ts');
  const base = existsSync(own) ? own : undefined;
  projects.push(project(pkg, 'unit', base), project(pkg, 'property', base));
}

export default defineWorkspace(projects);
