// T-QA-020: no-real-time flags Date.now() and passes clock.now(); no-random flags Math.random().
import { RuleTester } from 'eslint';
import { describe, it } from 'node:test';
import noRealTime from '../no-real-time.js';
import noRandom from '../no-random.js';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

describe('gavel/no-real-time', () => {
  it('flags wall clock reads and allows clock.now()', () => {
    tester.run('no-real-time', noRealTime, {
      valid: [
        'const t = clock.now();',
        'const d = new Date(1700000000000);',
        'const d = new Date("2025-01-01T00:00:00Z");',
        'const n = Date.parse("2025-01-01");',
      ],
      invalid: [
        { code: 'const t = Date.now();', errors: [{ messageId: 'realTime' }] },
        { code: 'const t = Date["now"]();', errors: [{ messageId: 'realTime' }] },
        { code: 'const d = new Date();', errors: [{ messageId: 'realTime' }] },
        { code: 'const t = performance.now();', errors: [{ messageId: 'realTime' }] },
      ],
    });
  });
});

describe('gavel/no-random', () => {
  it('flags Math.random and allows a seeded prng', () => {
    tester.run('no-random', noRandom, {
      valid: ['const x = prng.next();', 'const y = Math.floor(3.5);'],
      invalid: [
        { code: 'const x = Math.random();', errors: [{ messageId: 'random' }] },
        { code: 'const f = Math["random"];', errors: [{ messageId: 'random' }] },
      ],
    });
  });
});
