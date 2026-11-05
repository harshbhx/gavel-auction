import { randomInt } from 'node:crypto';
import fc from 'fast-check';

// R-QA-023: at least 200 cases per property and a seed that varies between runs. The seed is
// printed; pin it with GAVEL_PROPERTY_SEED to replay a failure. CI uses GITHUB_RUN_ID.
const pinned = Number(process.env['GAVEL_PROPERTY_SEED']);
const ci = Number(process.env['GITHUB_RUN_ID']);
const seed = Number.isInteger(pinned)
  ? pinned
  : Number.isSafeInteger(ci) && ci > 0
    ? ci % 2 ** 31
    : randomInt(2 ** 31);
fc.configureGlobal({ numRuns: 200, seed });
console.log(
  `shared property tests: seed=${seed} numRuns=200 (replay with GAVEL_PROPERTY_SEED=${seed})`,
);
