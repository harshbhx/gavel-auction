import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../src/dsl/load';
import type { Scenario } from '../src/dsl/types';
import { runScenarioInProc } from '../src/runner/inproc';

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'scenarios');

function filesFor(prefix: string): string[] {
  return readdirSync(DIR)
    .filter((f) => f.startsWith(`${prefix}-`))
    .sort();
}

function scenarioFor(prefix: string): Scenario {
  const file = filesFor(prefix)[0];
  expect(file).toBeDefined();
  return loadScenarioFile(join(DIR, file ?? ''));
}

describe('voice, webhook and crash scenarios (R-QA-026, R-QA-027)', () => {
  it('S02 turns a clear utterance into a bid and asks about an ambiguous one', async () => {
    const result = await runScenarioInProc(scenarioFor('S02'));
    expect(result.failures).toEqual([]);
    // Ben's declined confirmation places nothing; his accepted one and Ana's clear bid do.
    expect(result.outcome.accepted).toBe(2);
    expect(result.outcome.rejected).toEqual([{ actor: 'ben', code: 'unconfirmed' }]);
    expect(result.outcome.winner).toBe('ana');
    expect(result.outcome.priceCents).toBe(30000);
    const said = result.trace.filter((e) => e.data['do'] === 'say');
    expect(said).toHaveLength(3);
  });

  it('S04 captures once when the capture webhook arrives fifty times', async () => {
    const result = await runScenarioInProc(scenarioFor('S04'));
    expect(result.failures).toEqual([]);
    const { delivered, ok, stored } = result.outcome.webhooks;
    expect(delivered).toBe(50);
    expect(ok).toBe(50);
    expect(stored).toBe(1);
    expect(delivered - stored).toBe(49);
    expect(result.outcome.paypalCalls.capture).toBe(1);
    expect(result.outcome.capturedCents).toBe(8000);
  });

  it('S05 leaves the same outcome as ordered delivery', async () => {
    const scenario = scenarioFor('S05');
    const shuffled = await runScenarioInProc(scenario);
    expect(shuffled.failures).toEqual([]);
    const ordered: Scenario = {
      ...scenario,
      steps: scenario.steps.map((s) =>
        s.do === 'fault' && s.fault.at === 'webhook' && s.fault.kind === 'reorder'
          ? { ...s, fault: { ...s.fault, kind: 'delay' as const, ms: 0 } }
          : s,
      ),
    };
    const baseline = await runScenarioInProc(ordered);
    expect(baseline.failures).toEqual([]);
    const strip = (o: typeof shuffled.outcome): typeof o => ({
      ...o,
      webhooks: { delivered: 0, ok: 0, stored: 0 },
    });
    expect(strip(shuffled.outcome)).toEqual(strip(baseline.outcome));
  });

  it('S03 has one stack scenario per checkpoint and the in-process runner refuses a kill', async () => {
    const files = filesFor('S03');
    expect(files).toHaveLength(6);
    const checkpoints = files.map((f) => {
      const scenario = loadScenarioFile(join(DIR, f));
      expect(scenario.modes).toEqual(['stack']);
      const kill = scenario.steps.find((s) => s.do === 'fault' && s.fault.at === 'server');
      expect(kill).toBeDefined();
      return kill !== undefined && kill.do === 'fault' && kill.fault.at === 'server'
        ? kill.fault.checkpoint
        : '';
    });
    expect(new Set(checkpoints).size).toBe(6);
    expect(checkpoints.sort()).toEqual(
      [
        'after_capture_recorded',
        'after_capture_request_before_response',
        'after_winner_selected',
        'before_capture_request',
        'before_final_ledger',
        'during_void_loop:1',
      ].sort(),
    );
    await expect(runScenarioInProc(loadScenarioFile(join(DIR, files[0] ?? '')))).rejects.toThrow(
      /server.kill needs the stack runner/,
    );
  });
});
