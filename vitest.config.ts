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
