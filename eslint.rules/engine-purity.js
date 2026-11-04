// Flat-config block that keeps packages/engine free of I/O imports (R-QA-002).
// Wall-clock and randomness are covered by scripts/check-engine-purity.mjs.

const IO_MODULES = [
  'fs',
  'fs/promises',
  'net',
  'http',
  'https',
  'http2',
  'dgram',
  'dns',
  'tls',
  'child_process',
  'cluster',
  'worker_threads',
  'os',
];

const patterns = IO_MODULES.flatMap((m) => [m, `node:${m}`]);

export default {
  files: ['packages/engine/src/**/*.ts'],
  ignores: ['packages/engine/src/testing/**'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: patterns.map((name) => ({
          name,
          message: 'packages/engine must stay pure: no node I/O imports (R-QA-002).',
        })),
      },
    ],
  },
};
