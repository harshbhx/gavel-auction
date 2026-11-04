import { defineConfig } from 'vitest/config';

// Project definitions live in vitest.workspace.ts; this file holds the settings that only
// apply at the root, namely coverage (consumed by scripts/check-coverage.mjs).
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['json-summary', 'text-summary'],
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts', '**/testing/**', '**/index.ts'],
    },
  },
});
