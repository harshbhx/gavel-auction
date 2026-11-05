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

/**
 * Seed 1988800899, scenario 666 (issue #1443): a late bid whose `at + extensionMs` is below the
 * current end leaves `endsAt` unchanged. That is not an extension (D-0027), so it must not use
 * up maxExtensions; the reference used to count it and stopped extending one bid early.
 */
const PINNED_SEED_1988800899_666 = `{"id":666,"config":{"mode":"proxy","reserve":1,"minIncrement":1,"endTs":20000,"softCloseWindow":10000,"softCloseExtension":5000,"maxExtensions":1},"steps":[{"op":"register","at":0,"bidder":"b0","ceiling":100000},{"op":"register","at":0,"bidder":"b1","ceiling":3000},{"op":"register","at":0,"bidder":"b2","ceiling":3000},{"op":"register","at":0,"bidder":"b3","ceiling":3000},{"op":"register","at":0,"bidder":"b4","ceiling":800},{"op":"bid","at":738,"bidder":"b3","amount":3},{"op":"tick","at":5211},{"op":"bid","at":9109,"bidder":"b0","amount":5},{"op":"bid","at":11406,"bidder":"b3","amount":4},{"op":"bid","at":17179,"bidder":"b2","amount":4},{"op":"bid","at":18066,"bidder":"b2","amount":7},{"op":"bid","at":23149,"bidder":"b4","amount":4230},{"op":"bid","at":23938,"bidder":"b2","amount":9},{"op":"bid","at":25807,"bidder":"b1","amount":9},{"op":"bid","at":33129,"bidder":"b4","amount":3858},{"op":"bid","at":37395,"bidder":"b1","amount":2},{"op":"bid","at":37614,"bidder":"b3","amount":4288},{"op":"hammer","at":37615}],"outcome":{"winner":"b2","price":6,"ranking":[["b2",7],["b0",5],["b3",4]],"rejects":["closed","closed","closed","closed","closed","closed"],"endsAt":22179}}`;

describe('differential: pinned regressions', () => {
  it('T-ENG-082 seed 1988800899 scenario 666 agrees on endsAt', () => {
    const sc = JSON.parse(PINNED_SEED_1988800899_666) as Scenario;
    const fx: Fixture = {
      name: `scenario-${sc.id}`,
      parity: true,
      config: sc.config,
      steps: sc.steps,
      expect: sc.outcome,
    };
    const got = play(fx);
    expect(differences(got, sc.outcome)).toEqual([]);
    expect(got.endsAt).toBe(22179);
  });
});
