import { defineConfig } from 'vitest/config';

// Coverage gate for the engine (R-ENG-122): at least 95% of lines and 90% of branches of src/.
// Run it with `npm run test:coverage -w @gavel/engine`.
export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['**/*.d.ts', 'src/testing/**', 'src/index.ts'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: { lines: 95, branches: 90 },
    },
  },
});
