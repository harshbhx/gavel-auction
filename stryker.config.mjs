// Mutation testing for the engine and the payments saga (R-QA-024).
// The target comes from STRYKER_TARGET: engine (default), saga, or seeded (the pipeline check
// that mutation.yml runs against a throw away fixture). The score threshold is 80 and does not
// break the run; the surviving mutants are listed in reports/mutation/mutation.json.
const TARGETS = {
  engine: {
    mutate: ['packages/engine/src/**/*.ts', '!packages/engine/src/**/index.ts'],
    configFile: 'packages/engine/vitest.config.ts',
    dir: 'packages/engine',
  },
  saga: {
    mutate: ['packages/payments/src/saga/**/*.ts'],
    configFile: 'packages/payments/vitest.config.ts',
    dir: 'packages/payments',
  },
  seeded: {
    mutate: ['tmp-seeded/cmp.ts'],
    configFile: 'tmp-seeded/vitest.config.ts',
    dir: 'tmp-seeded',
  },
};

const name = process.env.STRYKER_TARGET ?? 'engine';
const target = TARGETS[name];
if (target === undefined) {
  throw new Error(`unknown STRYKER_TARGET "${name}", use engine, saga or seeded`);
}

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: target.configFile, dir: target.dir },
  mutate: target.mutate,
  coverageAnalysis: 'perTest',
  inPlace: true,
  ignoreStatic: true,
  thresholds: { high: 80, low: 80, break: null },
  reporters: ['clear-text', 'json', 'html'],
  jsonReporter: { fileName: `reports/mutation/${name}/mutation.json` },
  htmlReporter: { fileName: `reports/mutation/${name}/index.html` },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
  timeoutMS: 30000,
  concurrency: 2,
};
