import { defineConfig } from 'vitest/config';

// The real-sandbox specs live outside test/ so the unit project never picks them up. Run them with
// `npm run test:sandbox -w @gavel/e2e`; without the sandbox secrets every spec is skipped.
export default defineConfig({
  test: {
    include: ['sandbox/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
