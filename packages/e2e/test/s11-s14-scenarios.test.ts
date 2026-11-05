import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../src/dsl/load';
import { runScenarioInProc } from '../src/runner/inproc';

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'scenarios');

function scenarioFor(prefix: string): ReturnType<typeof loadScenarioFile> {
  const file = readdirSync(DIR).find((f) => f.startsWith(`${prefix}-`));
  expect(file).toBeDefined();
  return loadScenarioFile(join(DIR, file ?? ''));
}

describe('race, soft close and payment retry scenarios (R-QA-026, R-QA-030)', () => {
  it('S11 settles to the last accepted bid across 100 seeded iterations', async () => {
    const base = scenarioFor('S11');
    for (let i = 0; i < 100; i += 1) {
      const result = await runScenarioInProc({ ...base, seed: 1100 + i });
      expect(result.failures).toEqual([]);
      expect(result.outcome.winner).toBe('ben');
      expect(result.outcome.capturedCents).toBe(15500);
    }
  }, 120000);

  it('S12 settles after bids inside the soft close window', async () => {
    const result = await runScenarioInProc(scenarioFor('S12'));
    expect(result.failures).toEqual([]);
    expect(result.outcome.winner).toBe('ben');
    expect(result.outcome.capturedCents).toBe(8500);
  });

  it('S13 captures once after two 503 responses', async () => {
    const result = await runScenarioInProc(scenarioFor('S13'));
    expect(result.failures).toEqual([]);
    expect(result.outcome.winner).toBe('ana');
    expect(result.outcome.capturedCents).toBe(10000);
  });

  it('S14 releases the losing hold after three void failures', async () => {
    const result = await runScenarioInProc(scenarioFor('S14'));
    expect(result.failures).toEqual([]);
    expect(result.outcome.winner).toBe('ana');
    expect(result.outcome.capturedCents).toBe(10000);
  });
});
