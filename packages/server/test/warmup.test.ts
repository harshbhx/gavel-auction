import { describe, expect, it } from 'vitest';
import { availability, INITIAL_PROBE_STATE, nextProbeState, roundOk } from '../src/warmup/probe';
import { runWarmup } from '../src/warmup/warmup';

describe('warmup', () => {
  it('reports ok when every step finishes within the budget', async () => {
    const report = await runWarmup({
      steps: [
        { name: 'database', run: () => Promise.resolve() },
        { name: 'paypal-token', run: () => Promise.resolve() },
      ],
    });
    expect(report.ok).toBe(true);
    expect(report.steps.map((s) => s.name)).toEqual(['database', 'paypal-token']);
  });

  it('reports not ok when a step fails', async () => {
    const report = await runWarmup({
      steps: [
        { name: 'database', run: () => Promise.resolve() },
        { name: 'paypal-token', run: () => Promise.reject(new Error('down')) },
      ],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[1]?.ok).toBe(false);
  });

  it('reports not ok when a step outlives the budget', async () => {
    const report = await runWarmup({
      budgetMs: 20,
      steps: [{ name: 'slow', run: () => new Promise<void>((r) => setTimeout(r, 200)) }],
    });
    expect(report.ok).toBe(false);
  });
});

describe('probe state', () => {
  it('alerts after two consecutive failures and clears on success', () => {
    const one = nextProbeState(INITIAL_PROBE_STATE, false);
    expect(one.alert).toBe(false);
    const two = nextProbeState(one, false);
    expect(two.alert).toBe(true);
    expect(nextProbeState(two, true)).toEqual(INITIAL_PROBE_STATE);
  });

  it('a success between failures resets the count', () => {
    const a = nextProbeState(INITIAL_PROBE_STATE, false);
    const b = nextProbeState(a, true);
    expect(nextProbeState(b, false).alert).toBe(false);
  });

  it('roundOk needs all statuses 2xx and availability is a fraction', () => {
    expect(roundOk([200, 200, 204])).toBe(true);
    expect(roundOk([200, 503])).toBe(false);
    expect(roundOk([])).toBe(false);
    expect(availability([true, true, true, false])).toBe(0.75);
    expect(availability([])).toBe(1);
  });
});
