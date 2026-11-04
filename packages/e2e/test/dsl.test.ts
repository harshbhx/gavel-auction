import { describe, expect, it } from 'vitest';
import { ScenarioError, parseScenarioYaml } from '../src/index';

const S04 = `
id: S04-duplicate-webhooks
title: Duplicate and delayed capture webhooks cause one transition
modes: [inproc, stack]
seed: 4
clock: { startMs: 1793750400000 }
auction: { itemId: lot-1, reserve: 5000, minIncrement: 500, softCloseMs: 0, mode: english }
actors: { ana: { funding: wallet }, ben: { funding: card } }
steps:
  - { t: 0, actor: ana, do: register, ceiling: 50000 }
  - { t: 0, actor: ben, do: register, ceiling: 25000 }
  - { t: 1000, actor: auctioneer, do: open }
  - { t: 2000, actor: ana, do: bid, amount: 6000 }
  - { t: 3000, actor: ben, do: bid, amount: 7000 }
  - { t: 4000, do: fault, fault: { at: webhook, kind: duplicate, event: PAYMENT.CAPTURE.COMPLETED, times: 49 } }
  - { t: 5000, actor: auctioneer, do: hammer }
expect:
  - ledger: { winner: ben, captured: 7000, released: 18000, voided: [ana] }
  - paypalCalls: { capture: 1, void: 1 }
  - invariants: [I1, I2, I3, I4, I5]
`;

describe('scenario loader (T-QA-027)', () => {
  it('loads the S04 example', () => {
    const s = parseScenarioYaml(S04, 'S04.yaml');
    expect(s.id).toBe('S04-duplicate-webhooks');
    expect(s.steps).toHaveLength(7);
    expect(s.expect).toHaveLength(3);
    expect(s.modes).toEqual(['inproc', 'stack']);
  });

  it('names the step index for a bad step', () => {
    const bad = S04.replace('amount: 7000', 'amount: -5');
    try {
      parseScenarioYaml(bad, 'bad.yaml');
      expect.unreachable('expected a ScenarioError');
    } catch (err) {
      expect(err).toBeInstanceOf(ScenarioError);
      expect((err as ScenarioError).issues.some((i) => i.startsWith('steps[4]'))).toBe(true);
      expect((err as ScenarioError).message).toContain('bad.yaml');
    }
  });

  it('rejects an unknown step verb with its index', () => {
    const bad = S04.replace('do: hammer', 'do: smash');
    expect(() => parseScenarioYaml(bad)).toThrow(/steps\[6\]/);
  });

  it('rejects an unknown error code in expectations', () => {
    const bad = S04.replace(
      'expect:',
      'expect:\n  - { rejected: [{ actor: ana, code: NOT_A_CODE }] }',
    );
    expect(() => parseScenarioYaml(bad)).toThrow(/expect\[0\]/);
  });

  it('reports malformed yaml', () => {
    expect(() => parseScenarioYaml('a: [unclosed')).toThrow(ScenarioError);
  });
});
