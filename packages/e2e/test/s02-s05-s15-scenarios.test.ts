import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Cents } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../src/dsl/load';
import type { Checkpoint, Scenario } from '../src/dsl/types';
import { runScenarioInProc } from '../src/runner/inproc';

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'scenarios');

function scenarioFor(prefix: string): Scenario {
  const file = readdirSync(DIR).find((f) => f.startsWith(`${prefix}-`));
  expect(file).toBeDefined();
  return loadScenarioFile(join(DIR, file ?? ''));
}

const SIX_CHECKPOINTS: Checkpoint[] = [
  'after_winner_selected',
  'before_capture_request',
  'after_capture_request_before_response',
  'after_capture_recorded',
  'during_void_loop:1',
  'before_final_ledger',
];

describe('voice, webhook, crash and restart scenarios (R-QA-026, R-QA-027)', () => {
  it('S02 turns a clear utterance into a bid, asks on an ambiguous one and honours a decline', async () => {
    const result = await runScenarioInProc(scenarioFor('S02'));
    expect(result.failures).toEqual([]);
    expect(result.outcome.voice.bids).toEqual([5000, 30000]);
    expect(result.outcome.voice.confirms).toBe(2);
  });

  it('S02 fails when the expected audit row is altered', async () => {
    const scenario = scenarioFor('S02');
    const altered: Scenario = {
      ...scenario,
      expect: [
        {
          voice: {
            bids: [30000 as Cents],
            confirms: 0,
          },
        },
      ],
    };
    const result = await runScenarioInProc(altered);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it.each(SIX_CHECKPOINTS)(
    'S03 settles with one capture after a kill at %s',
    async (checkpoint) => {
      const scenario = scenarioFor('S03');
      const steps = scenario.steps.map((s) =>
        s.do === 'fault' && s.fault.at === 'server'
          ? { ...s, fault: { ...s.fault, checkpoint } }
          : s,
      );
      const result = await runScenarioInProc({ ...scenario, steps });
      expect(result.failures).toEqual([]);
      expect(result.outcome.crashes).toBe(1);
      expect(result.outcome.restarts).toBe(1);
      expect(result.outcome.captures).toEqual({ committed: 1, requestIds: 1 });
    },
  );

  it('S04 applies one capture event out of fifty deliveries', async () => {
    const result = await runScenarioInProc(scenarioFor('S04'));
    expect(result.failures).toEqual([]);
    expect(result.outcome.webhooks.duplicates).toBe(49);
    expect(result.outcome.captures.committed).toBe(1);
  });

  it('S05 ends exactly as ordered delivery does', async () => {
    const scenario = scenarioFor('S05');
    const ordered: Scenario = {
      ...scenario,
      steps: scenario.steps.filter((s) => !(s.do === 'fault' && s.fault.at === 'webhook')),
    };
    const shuffled = await runScenarioInProc(scenario);
    const baseline = await runScenarioInProc(ordered);
    expect(shuffled.failures).toEqual([]);
    expect(shuffled.outcome.webhooks.delivered).toBeGreaterThan(0);
    expect({ ...shuffled.outcome, webhooks: null }).toEqual({
      ...baseline.outcome,
      webhooks: null,
    });
  });

  it('S15 keeps bidders, bids and price across a restart and resyncs both clients', async () => {
    const result = await runScenarioInProc(scenarioFor('S15'));
    expect(result.failures).toEqual([]);
    expect(result.outcome.restarts).toBe(1);
    expect(result.outcome.resynced).toBe(2);
    expect(result.outcome.accepted).toBe(5);
    expect(result.outcome.rejected).toEqual([]);
  });
});
