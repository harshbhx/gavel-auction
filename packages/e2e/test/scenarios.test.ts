import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../src/index';
import type { Scenario } from '../src/index';
import type { Cents } from '@gavel/shared';
import {
  assertSupported,
  checkExpectations,
  runScenarioInProc,
  scenarioConfig,
} from './flow/scenario-runner';

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'scenarios');

/** Scenarios that have a file and are executed here (R-QA-026). Add an id once its file exists. */
const IMPLEMENTED = [
  'S01',
  'S02',
  'S03',
  'S04',
  'S05',
  'S06',
  'S07',
  'S08',
  'S09',
  'S10',
  'S11',
  'S12',
  'S13',
  'S14',
  'S15',
];
/** Still to be written; the job lists them so a green run is never read as full coverage. */
const PENDING = ['S16'];

const open: Array<{ stop(): Promise<void> }> = [];
afterEach(async () => {
  for (const p of open.splice(0)) await p.stop();
});

const files = readdirSync(DIR).filter((f) => f.endsWith('.yaml'));

describe('scenario execution (R-QA-025, R-QA-026)', () => {
  it('has a scenario file for every implemented id and none unlisted', () => {
    const ids = files.map((f) => f.split('-')[0]).sort();
    expect(ids).toEqual([...IMPLEMENTED].sort());
    expect(PENDING.some((p) => IMPLEMENTED.includes(p))).toBe(false);
  });

  const s01 = (): Scenario => {
    const file = files.find((f) => f.startsWith('S01-'));
    expect(file).toBeDefined();
    return loadScenarioFile(join(DIR, file ?? ''));
  };

  it('S01 runs through the real room, engine and fake PayPal and matches its expectations', async () => {
    const scenario = s01();
    const outcome = await runScenarioInProc(scenario, open);
    expect(outcome.winner).toBe('ana');
    expect(outcome.priceCents).toBe(10000);
    expect(outcome.accepted).toBe(5);
    expect(outcome.rejected).toEqual([]);
    expect(outcome.invariants).toEqual({ I1: true, I2: true, I3: true, I4: true });
    expect(checkExpectations(scenario, outcome)).toEqual([]);
  });

  it('builds the config from the scenario fields it declares (R9-V04)', () => {
    const scenario = s01();
    const declared: Scenario = {
      ...scenario,
      clock: { startMs: scenario.clock.startMs },
      auction: { ...scenario.auction, softCloseMs: 12_000 },
    };
    const config = scenarioConfig(declared) as unknown as Record<string, unknown>;
    expect(config['softCloseWindowMs']).toBe(12_000);
    expect(config['mode']).toBe('english');
    expect(config['endTs']).toBe(scenario.clock.startMs + 600_000);
    expect(config['reserve']).toBe(scenario.auction.reserve);
  });

  it('rejects a scenario that declares card funding instead of ignoring it', async () => {
    const scenario = s01();
    const card: Scenario = {
      ...scenario,
      actors: { ...scenario.actors, ben: { funding: 'card' } },
    };
    expect(() => assertSupported(card)).toThrow(/ben funding "card" is not supported/);
    await expect(runScenarioInProc(card, open)).rejects.toThrow(/not supported/);
    expect(() => assertSupported(scenario)).not.toThrow();
  });

  it('reports a failing comparison for a wrong expectation (not vacuous)', async () => {
    const scenario = s01();
    const outcome = await runScenarioInProc(scenario, open);
    const wrongLedger: Scenario = {
      ...scenario,
      expect: [
        {
          ledger: {
            winner: 'ben',
            captured: 9000 as Cents,
            released: 41000 as Cents,
            voided: ['ana'],
          },
        },
      ],
    };
    expect(checkExpectations(wrongLedger, outcome)[0]).toMatch(/^ledger: expected/);
    const brokenRun = { ...outcome, invariants: { ...outcome.invariants, I2: false } };
    expect(checkExpectations(scenario, brokenRun)).toEqual(['invariant I2 does not hold']);
  });

  it('fails on an expect kind or invariant the runner does not evaluate', async () => {
    const scenario = s01();
    const outcome = await runScenarioInProc(scenario, open);
    const unknown: Scenario = { ...scenario, expect: [{ paypalCalls: { capture: 1, void: 1 } }] };
    expect(checkExpectations(unknown, outcome)).toHaveLength(1);
    const i5: Scenario = { ...scenario, expect: [{ invariants: ['I5'] }] };
    expect(checkExpectations(i5, outcome)).toEqual(['invariant I5 is not evaluated by the runner']);
  });

  it('rejects a repeated bid that is below the minimum increment', async () => {
    const scenario = s01();
    const first = scenario.steps.find((s) => s.do === 'bid');
    expect(first).toBeDefined();
    if (first === undefined) return;
    const repeated: Scenario = {
      ...scenario,
      steps: [...scenario.steps, { ...first, t: first.t + 500 }],
    };
    const outcome = await runScenarioInProc(repeated, open);
    expect(outcome.rejected).toEqual([{ actor: 'ana', reason: 'below_increment' }]);
  });
});
