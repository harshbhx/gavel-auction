import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Fixture } from '../src/testing/fixtures.js';
import { differences, play } from './golden-play.js';

/**
 * R-ENG-114: compares the TypeScript engine with the Python reference on seeded scenarios.
 * The scenario file comes from `python reference/python/scenario_export.py --seed 20261104
 * --n 2000`; set GAVEL_DIFFERENTIAL_FILE to its path. Without the variable the test is skipped.
 */
const FILE = process.env['GAVEL_DIFFERENTIAL_FILE'];
const MIN_SCENARIOS = 2000;

interface Scenario {
  id: number;
  config: Fixture['config'];
  steps: Fixture['steps'];
  outcome: Fixture['expect'];
}

function parseLines(text: string): Scenario[] {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Scenario);
}

describe.skipIf(FILE === undefined)('differential: TypeScript engine against Python', () => {
  it('T-ENG-082 R-ENG-114 matches winner, price, ranking and reasons on every scenario', () => {
    const scenarios = parseLines(readFileSync(FILE ?? '', 'utf8'));
    expect(scenarios.length).toBeGreaterThanOrEqual(MIN_SCENARIOS);
    for (const sc of scenarios) {
      const fx: Fixture = {
        name: `scenario-${sc.id}`,
        parity: true,
        config: sc.config,
        steps: sc.steps,
        expect: sc.outcome,
      };
      const got = play(fx);
      const bad = differences(got, sc.outcome);
      if (bad.length > 0) {
        throw new Error(
          `scenario ${sc.id} differs on ${bad.join(', ')}\nscenario: ${JSON.stringify(sc)}\n` +
            `typescript: ${JSON.stringify(got)}`,
        );
      }
    }
  });
});
