import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// Used only by Stryker (mutation.yml, target engine). The instrumented code runs several times
// slower, so the timing budget tests (perf.test.ts) fail in the initial run for reasons that have
// nothing to do with correctness; they keep running in the normal unit job.
export default mergeConfig(
  base,
  defineConfig({
    test: { exclude: [...configDefaults.exclude, 'test/perf.test.ts'] },
  }),
);
