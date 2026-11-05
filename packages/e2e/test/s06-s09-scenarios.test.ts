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

describe('settlement fallback and reconnect scenarios (R-QA-026)', () => {
  it('S06 charges the runner-up and never the winner whose hold was voided', async () => {
    const result = await runScenarioInProc(scenarioFor('S06'));
    expect(result.failures).toEqual([]);
    expect(result.outcome.winner).toBe('ben');
    expect(result.outcome.capturedCents).toBe(9000);
    expect(result.outcome.paypalCalls.capture).toBe(1);
  });

  it('S07 ends with no charge when every hold is invalid', async () => {
    const result = await runScenarioInProc(scenarioFor('S07'));
    expect(result.failures).toEqual([]);
    expect(result.outcome.capturedCents).toBe(0);
    expect(result.outcome.paypalCalls.capture).toBe(0);
  });

  it('S08 never charges a winner whose hold expired', async () => {
    const result = await runScenarioInProc(scenarioFor('S08'));
    expect(result.failures).toEqual([]);
    expect(result.outcome.winner).not.toBe('ana');
  });

  it('S09 keeps price and bids across a client drop with no duplicate bid', async () => {
    const result = await runScenarioInProc(scenarioFor('S09'));
    expect(result.failures).toEqual([]);
    expect(result.outcome.accepted).toBe(3);
    expect(result.outcome.rejected).toEqual([]);
  });

  it('is deterministic: two runs give the same outcome', async () => {
    const a = await runScenarioInProc(scenarioFor('S06'));
    const b = await runScenarioInProc(scenarioFor('S06'));
    expect(b.outcome).toEqual(a.outcome);
  });
});
