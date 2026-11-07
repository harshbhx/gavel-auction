import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../src/dsl/load';
import type { Scenario } from '../src/dsl/types';
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

  it('S12 extends the end five times, never shortens it, then settles', async () => {
    const result = await runScenarioInProc(scenarioFor('S12'));
    expect(result.failures).toEqual([]);
    expect(result.outcome.softClose).toEqual({ extensions: 5, shortened: false });
    expect(result.outcome.winner).toBe('ben');
    expect(result.outcome.capturedCents).toBe(11500);
  });

  it('S13 captures once after two 503 responses', async () => {
    const result = await runScenarioInProc(scenarioFor('S13'));
    expect(result.failures).toEqual([]);
    expect(result.outcome.winner).toBe('ana');
    expect(result.outcome.capturedCents).toBe(10000);
    expect(result.outcome.captures).toEqual({ committed: 1, requestIds: 1 });
    expect(result.outcome.backoffMs).toEqual([249, 499]);
  });

  it('S13 ends in FAILED_NEEDS_REVIEW when the 503 answers never stop', async () => {
    const base = scenarioFor('S13');
    const steps = base.steps.map((s) =>
      s.do === 'fault' && s.fault.at === 'paypal.capture' && s.fault.kind === 'http'
        ? { ...s, fault: { ...s.fault, times: 99 } }
        : s,
    );
    const exhausted: Scenario = {
      ...base,
      steps: [...steps, { t: 7100, do: 'advance_clock', ms: 600_001 }],
      expect: [
        { settlement: { auction: 'FAILED_NEEDS_REVIEW' } },
        { captures: { committed: 0, requestIds: 1 } },
      ],
    };
    const result = await runScenarioInProc(exhausted);
    expect(result.failures).toEqual([]);
    expect(result.outcome.capturedCents).toBe(0);
  });

  it('S13 manual resolve needs the admin key and only works in review', async () => {
    const base = scenarioFor('S13');
    const steps = base.steps.map((s) =>
      s.do === 'fault' && s.fault.at === 'paypal.capture' && s.fault.kind === 'http'
        ? { ...s, fault: { ...s.fault, times: 99 } }
        : s,
    );
    const resolved: Scenario = {
      ...base,
      steps: [
        { t: 6900, do: 'ops_release', key: 'valid' },
        ...steps,
        { t: 7100, do: 'advance_clock', ms: 600_001 },
        { t: 7200, do: 'ops_release', key: 'missing' },
        { t: 7300, do: 'ops_release', key: 'wrong' },
        { t: 7400, do: 'ops_release', key: 'valid' },
      ],
      expect: [
        { ops: { statuses: [409, 401, 401, 200] } },
        { captures: { committed: 0, requestIds: 1 } },
      ],
    };
    const result = await runScenarioInProc(resolved);
    expect(result.failures).toEqual([]);
    expect(result.outcome.capturedCents).toBe(0);
  });

  it('S14 releases the losing hold after three void failures', async () => {
    const result = await runScenarioInProc(scenarioFor('S14'));
    expect(result.failures).toEqual([]);
    expect(result.outcome.winner).toBe('ana');
    expect(result.outcome.capturedCents).toBe(10000);
  });
});
