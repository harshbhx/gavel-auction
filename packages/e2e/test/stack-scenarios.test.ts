import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../src/dsl/load';
import type { Checkpoint, Scenario } from '../src/dsl/types';
import { runScenarioInStack } from '../src/runner/stack-driver';

// T-QA-032, T-QA-037, T-QA-044 (R-QA-026, R-QA-027): the crash, reconnect and restart scenarios on
// the real server over HTTP and WebSocket, with the fake PayPal in a process that outlives every
// server kill.

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

const TIMEOUT_MS = 180_000;

describe('stack mode scenarios', () => {
  it.each(SIX_CHECKPOINTS)(
    'S03 settles with one capture and one request id after a kill at %s',
    async (checkpoint) => {
      const scenario = scenarioFor('S03');
      expect(scenario.modes).toContain('stack');
      const steps = scenario.steps.map((s) =>
        s.do === 'fault' && s.fault.at === 'server'
          ? { ...s, fault: { ...s.fault, checkpoint } }
          : s,
      );
      const result = await runScenarioInStack({ ...scenario, steps });
      expect(result.failures).toEqual([]);
      expect(result.outcome.crashes).toBe(1);
      expect(result.outcome.captures).toEqual({ committed: 1, requestIds: 1 });
    },
    TIMEOUT_MS,
  );

  it(
    'S09 keeps state across a client drop',
    async () => {
      const scenario = scenarioFor('S09');
      expect(scenario.modes).toContain('stack');
      const result = await runScenarioInStack(scenario);
      expect(result.failures).toEqual([]);
      expect(result.outcome.rejected).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    'S15 keeps registered bidders, bids and price across a server restart',
    async () => {
      const scenario = scenarioFor('S15');
      expect(scenario.modes).toContain('stack');
      const result = await runScenarioInStack(scenario);
      expect(result.failures).toEqual([]);
      expect(result.outcome.restarts).toBe(1);
      expect(result.outcome.resynced).toBe(2);
    },
    TIMEOUT_MS,
  );
});
