import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The root is pinned to this package: Stryker (mutation.yml, target saga) starts vitest from the
// repository root, where './test/setup.ts' does not exist.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    environment: 'node',
  },
});
