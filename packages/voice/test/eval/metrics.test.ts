import { describe, expect, it } from 'vitest';
import { gateG5, runHarness } from '../../src/eval/harness.js';
import {
  evaluate,
  type Actual,
  type EvalResult,
  type Expected,
  type Metrics,
  type Pair,
} from '../../src/eval/metrics.js';

const p = (who: string, amountCents: number): Pair => ({ who, amountCents });

function item(
  id: string,
  expected: Expected,
  actual: Actual,
  latencyMs: number,
  texts?: [string, string],
): EvalResult {
  return {
    id,
    expected,
    actual,
    latencyMs,
    provider: 'a',
    ...(texts ? { referenceText: texts[0], recognizedText: texts[1] } : {}),
  };
}

const bid = (who: string, cents: number): Expected => ({ outcome: 'bid', pair: p(who, cents) });
const none: Expected = { outcome: 'none' };

const TEN: EvalResult[] = [
  item('i1', bid('7', 30000), { kind: 'accept', pair: p('7', 30000) }, 100, [
    'three hundred',
    'three hundred',
  ]),
  item('i2', bid('7', 35000), { kind: 'accept', pair: p('7', 35000) }, 200),
  item('i3', bid('12', 40000), { kind: 'accept', pair: p('12', 40000) }, 300),
  item('i4', bid('4', 25000), { kind: 'confirm', candidates: [p('4', 20000), p('4', 25000)] }, 400),
  item('i5', bid('9', 50000), { kind: 'none' }, 500),
  item('i6', bid('3', 30000), { kind: 'accept', pair: p('3', 20000) }, 600, [
    'three hundred',
    'two hundred',
  ]),
  item(
    'i7',
    { outcome: 'confirm', intended: p('5', 10000), acceptableConfirm: [[p('5', 10000)]] },
    { kind: 'confirm', candidates: [p('5', 10000)] },
    700,
  ),
  item('i8', none, { kind: 'none' }, 800),
  item('i9', none, { kind: 'confirm', candidates: [p('1', 100)] }, 900),
  item('i10', none, { kind: 'none' }, 1000),
];

describe('T-VOX-082 harness metrics (R-VOX-074)', () => {
  it('computes the exact numbers on a hand-made 10-item set', () => {
    const m = evaluate(TEN);
    expect(m.n).toBe(10);
    expect(m.bidN).toBe(6);
    expect(m.exactRate).toBeCloseTo(3 / 6);
    expect(m.recoverableRate).toBeCloseTo(1 / 6);
    expect(m.missedBidRate).toBeCloseTo(1 / 6);
    expect(m.wrongAcceptRate).toBeCloseTo(1 / 10);
    expect(m.confirmRate).toBeCloseTo(3 / 10);
    expect(m.falsePromptRate).toBeCloseTo(1 / 3);
    expect(m.numberTokenErrorRate['a']).toBeCloseTo(0.5);
    expect(m.latencyP50Ms).toBe(500);
    expect(m.latencyP95Ms).toBe(1000);
  });

  it('counts an accept on a confirm or none label as a wrong accept', () => {
    const m = evaluate([
      item(
        'x',
        { outcome: 'confirm', acceptableConfirm: [] },
        { kind: 'accept', pair: p('1', 1) },
        1,
      ),
      item('y', none, { kind: 'accept', pair: p('1', 1) }, 1),
    ]);
    expect(m.wrongAcceptRate).toBe(1);
  });

  it('handles an empty set', () => {
    expect(evaluate([]).exactRate).toBe(0);
  });
});

function metricsOf(usable: number, wrongAccept: number): Metrics {
  return { ...evaluate([]), exactRate: usable, recoverableRate: 0, wrongAcceptRate: wrongAccept };
}

describe('T-VOX-084 gate G5 (R-VOX-076)', () => {
  it('passes at exactly 0.90 and 0.05', () => {
    const g = gateG5(metricsOf(0.9, 0.05));
    expect(g.pass).toBe(true);
    expect(g.notice).toBeNull();
  });

  it('adds exact and recoverable together', () => {
    expect(gateG5({ ...metricsOf(0.8, 0), recoverableRate: 0.1 }).pass).toBe(true);
  });

  it('fails at 0.89 with the assist-mode notice', () => {
    const g = gateG5(metricsOf(0.89, 0.05));
    expect(g.pass).toBe(false);
    expect(g.notice).toContain('assist mode');
  });

  it('fails at wrong accept 0.06', () => {
    const g = gateG5(metricsOf(0.95, 0.06));
    expect(g.pass).toBe(false);
    expect(g.notice).toContain('assist mode');
  });

  it('puts the verdict and notice in the report', () => {
    const { report, gate } = runHarness(TEN);
    expect(gate.pass).toBe(false);
    expect(report).toContain('G5 fail');
    expect(report).toContain('assist mode');
  });
});
