import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../src/index';
import type { Scenario, Step } from '../src/index';
import { runLadder } from '../src/runner/ladder';

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'scenarios');

/** Scenarios that have a file and are executed here (R-QA-026). Add an id once its file exists. */
const IMPLEMENTED = ['S01'];
/** Still to be written; the job lists them so a green run is never read as full coverage. */
const PENDING = [
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
  'S16',
];

const files = readdirSync(DIR).filter((f) => f.endsWith('.yaml'));

describe('scenario execution (R-QA-025, R-QA-026)', () => {
  it('has a scenario file for every implemented id and none unlisted', () => {
    const ids = files.map((f) => f.split('-')[0]).sort();
    expect(ids).toEqual([...IMPLEMENTED].sort());
    expect(PENDING.some((p) => IMPLEMENTED.includes(p))).toBe(false);
  });

  it('S01 runs end to end in process and matches its expectations', () => {
    const file = files.find((f) => f.startsWith('S01-'));
    expect(file).toBeDefined();
    const scenario = loadScenarioFile(join(DIR, file ?? ''));
    const result = runLadder(scenario);
    expect(result.winner).toBe('ana');
    expect(result.priceCents).toBe(10000);
    expect(result.accepted).toBe(5);
    expect(result.rejected).toEqual([]);
    const ledger = scenario.expect.find((e) => 'ledger' in e);
    expect(ledger).toEqual({
      ledger: {
        winner: result.winner,
        captured: result.capturedCents,
        released: result.releasedCents,
        voided: result.voided,
      },
    });
  });

  it('fails when the expected ledger no longer matches the run (not vacuous)', () => {
    const file = files.find((f) => f.startsWith('S01-')) ?? '';
    const scenario = loadScenarioFile(join(DIR, file));
    const broken: Scenario = {
      ...scenario,
      steps: scenario.steps.filter((s) => !(s.do === 'bid' && s.amount === 10000)),
    };
    expect(runLadder(broken).winner).toBe('ben');
  });

  it('rejects a bid below the minimum increment', () => {
    const file = files.find((f) => f.startsWith('S01-')) ?? '';
    const scenario = loadScenarioFile(join(DIR, file));
    const low: Scenario = {
      ...scenario,
      steps: scenario.steps.map(
        (s): Step =>
          s.do === 'bid' && s.amount === 6500
            ? { t: s.t, actor: s.actor, do: 'bid', amount: 6100 }
            : s,
      ),
    };
    expect(runLadder(low).rejected).toEqual([{ actor: 'ben', reason: 'too_low' }]);
  });
});
