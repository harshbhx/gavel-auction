import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadFixtures, parseFixture } from '../src/testing/fixtures.js';
import type { Fixture } from '../src/testing/fixtures.js';
import { differences, play } from './golden-play.js';

/**
 * R-ENG-112, R-ENG-113: every golden fixture is replayed against the decide/evolve
 * core and compared with `expect`, the same way reference/python/golden_runner.py does.
 */
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'golden');

const fixtures = loadFixtures(GOLDEN);

describe('golden fixtures against the TypeScript engine', () => {
  it('T-ENG-081 R-ENG-112 loads the shared fixtures', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures.map((f) => [f.name, f] as const))(
    'T-ENG-081 R-ENG-113 golden fixture %s',
    (_name, fx) => {
      const got = play(fx);
      const want = fx.expect;
      expect(differences(got, want)).toEqual([]);
    },
  );

  it('T-ENG-081 R-ENG-113 reports a difference when a result changes', () => {
    const fx: Fixture = {
      name: 'x',
      parity: true,
      config: { mode: 'english', endTs: 10000 },
      steps: [
        { op: 'register', at: 0, bidder: 'a', ceiling: 500 },
        { op: 'bid', at: 1000, bidder: 'a', amount: 100 },
        { op: 'hammer', at: 10000 },
      ],
      expect: { price: 101 },
    };
    expect(differences(play(fx), fx.expect)).toEqual(['price']);
    expect(differences(play(fx), { price: 100 })).toEqual([]);
    expect(() => parseFixture({ ...fx, expect: {} }, 'x.json')).toThrow(/non-empty/);
  });
});
