import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../src/dsl/load';
import type { Scenario, Step } from '../src/dsl/types';
import { runScenarioInProc } from '../src/runner/inproc';

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'scenarios');

function scenarioFor(prefix: string): Scenario {
  const file = readdirSync(DIR).find((f) => f.startsWith(`${prefix}-`));
  expect(file).toBeDefined();
  return loadScenarioFile(join(DIR, file ?? ''));
}

/** Small seeded generator so a failing iteration can be replayed from its seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const END = 600_000;
const INCREMENT = 500;

describe('S11 simultaneous bids and hammer (T-QA-039)', () => {
  it('matches its file expectations', async () => {
    const result = await runScenarioInProc(scenarioFor('S11'));
    expect(result.failures).toEqual([]);
    expect(result.outcome.winner).toBe('b20');
  }, 60_000);

  it('decides every bid before the hammer and refuses the rest, over 100 seeded iterations', async () => {
    const base = scenarioFor('S11');
    const registers = base.steps.filter((s) => s.do === 'register');
    const bids = base.steps.filter(
      (s): s is Extract<Step, { do: 'bid' }> => s.do === 'bid' && s.t < END,
    );
    const actors = bids.map((b) => b.actor);
    for (let i = 0; i < 100; i += 1) {
      const seed = 1100 + i;
      const rand = mulberry32(seed);
      const hammerAt = END - 100 + Math.floor(rand() * 100);
      const jittered = bids.map((b) => ({ ...b, t: END - 100 + Math.floor(rand() * 100) }));
      const steps: Step[] = [
        ...registers,
        { t: 1000, actor: 'auctioneer', do: 'open' },
        { t: hammerAt, actor: 'auctioneer', do: 'hammer' },
        ...jittered,
      ];
      // Model: bids in time order (ties in file order, as the runner sorts), the hammer first on a tie.
      const ordered = [...steps].sort((a, b) => a.t - b.t);
      let price = 0;
      let leader: string | null = null;
      let closed = false;
      const closedActors: string[] = [];
      for (const s of ordered) {
        if (s.do === 'hammer') closed = true;
        if (s.do !== 'bid') continue;
        if (closed) closedActors.push(s.actor);
        else if (s.amount >= price + INCREMENT) {
          price = s.amount;
          leader = s.actor;
        }
      }
      const scenario: Scenario = { ...base, seed, steps, expect: [] };
      const { outcome } = await runScenarioInProc(scenario, { seed });
      const label = `seed ${seed}`;
      expect({ label, winner: outcome.winner }).toEqual({ label, winner: leader });
      expect({ label, price: outcome.priceCents }).toEqual({ label, price });
      expect({ label, captured: outcome.capturedCents }).toEqual({ label, captured: price });
      const closedRejections = outcome.rejected.filter((r) => /closed|not_open/.test(r.code));
      expect(closedRejections.map((r) => r.actor).sort()).toEqual([...closedActors].sort());
      expect(Object.values(outcome.invariants).every(Boolean)).toBe(true);
      expect(actors.length).toBe(20);
    }
  }, 600_000);
});

describe('S12 soft close (T-QA-041)', () => {
  it('extends five times, never past the cap, and ends at the last deadline', async () => {
    const result = await runScenarioInProc(scenarioFor('S12'));
    expect(result.failures).toEqual([]);
    const { outcome } = result;
    expect(outcome.extensions).toBe(5);
    expect(outcome.endsAt).toBe(scenarioFor('S12').clock.startMs + 730_000);
    expect(outcome.accepted).toBe(7);
    expect(outcome.winner).toBe('ana');
  }, 60_000);

  it('does not extend for a bid outside the window', async () => {
    const base = scenarioFor('S12');
    const early: Scenario = {
      ...base,
      steps: base.steps.filter((s) => s.t < 200_000 || s.do === 'hammer'),
      expect: [],
    };
    const { outcome } = await runScenarioInProc(early);
    expect(outcome.extensions).toBe(0);
    expect(outcome.endsAt).toBe(base.clock.startMs + END);
  }, 60_000);
});

describe('S13 capture 5xx then recovery (T-QA-042)', () => {
  it('captures once after two failed attempts, with the same request id', async () => {
    const result = await runScenarioInProc(scenarioFor('S13'));
    expect(result.failures).toEqual([]);
    const { outcome } = result;
    expect(outcome.faultsFired.capture).toBe(2);
    expect(outcome.paypalCalls.capture).toBe(1);
    expect(outcome.captureRequestIds).toHaveLength(1);
    expect(outcome.captureRequestIds[0]).not.toBe('');
    expect(outcome.capturedCents).toBe(8000);
  }, 60_000);
});

describe('S14 void failure retried to exactly once (T-QA-043)', () => {
  it('voids the non-winner once after three failed attempts', async () => {
    const result = await runScenarioInProc(scenarioFor('S14'));
    expect(result.failures).toEqual([]);
    const { outcome } = result;
    expect(outcome.faultsFired.void).toBe(3);
    expect(outcome.paypalCalls.void).toBe(1);
    expect(outcome.voided).toEqual(['ben']);
  }, 60_000);
});
