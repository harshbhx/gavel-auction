// Flat-config block for the pure room core and packages/shared (R-RT-140, R-RT-151).
// No node: imports (WebCrypto only), no Date.now, no Math.random. Time comes from Clock, ids from Ids.
import noRealTime from '../../../eslint.rules/no-real-time.js';
import noRandom from '../../../eslint.rules/no-random.js';

const message = 'The room core must be runtime-agnostic: no node: imports (R-RT-140).';

export default {
  files: ['packages/server/src/room/**/*.ts', 'packages/shared/src/**/*.ts'],
  // SystemClock is the one place the wall clock is read.
  ignores: ['packages/shared/src/time.ts'],
  plugins: { gavel: { rules: { 'no-real-time': noRealTime, 'no-random': noRandom } } },
  rules: {
    'no-restricted-imports': ['error', { patterns: [{ group: ['node:*'], message }] }],
    'gavel/no-real-time': 'error',
    'gavel/no-random': 'error',
  },
};
