// Flat-config block that applies the no-real-time and no-random rules to test files and the
// in-process scenario runner (R-QA-022).
import noRealTime from './no-real-time.js';
import noRandom from './no-random.js';

export default {
  files: ['**/*.test.{ts,tsx}', '**/*.property.test.ts', 'packages/e2e/src/runner/**/*.ts'],
  // time.test.ts checks the real system clock helper, so it reads the wall clock on purpose.
  ignores: ['packages/shared/test/time.test.ts'],
  plugins: { gavel: { rules: { 'no-real-time': noRealTime, 'no-random': noRandom } } },
  rules: {
    'gavel/no-real-time': 'error',
    'gavel/no-random': 'error',
  },
};
