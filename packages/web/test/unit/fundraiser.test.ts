import { describe, expect, it } from 'vitest';
import { lotRaise, thermometer, totalRaise } from '../../src/screens/screen/fundraiser';

const holds = (...captured: number[]) => captured.map((capturedCents) => ({ capturedCents }));

describe('fundraiser cents math', () => {
  it('is hidden when no goal is set', () => {
    const raise = lotRaise(holds(5_000), null, null);
    expect(thermometer(null, raise)).toBeNull();
    expect(thermometer(undefined, raise)).toBeNull();
    expect(thermometer(0, raise)).toBeNull();
    expect(thermometer(-5, raise)).toBeNull();
    expect(thermometer(10.5, raise)).toBeNull();
  });

  it('sums only captured cents as raised', () => {
    const raise = lotRaise(holds(12_000, 0, 3_050), null, 'BIDDING');
    expect(raise).toEqual({ raisedCents: 15_050, onHoldCents: 0 });
  });

  it('keeps a held amount apart from raised', () => {
    const raise = lotRaise(holds(0), 40_000, 'CAPTURING');
    expect(raise).toEqual({ raisedCents: 0, onHoldCents: 40_000 });
    const t = thermometer(100_000, raise);
    expect(t?.fill).toBe(0);
    expect(t?.onHoldCents).toBe(40_000);
  });

  it('shows nothing on hold once the money is captured, released or failed', () => {
    expect(lotRaise(holds(40_000), 40_000, 'CAPTURED').onHoldCents).toBe(0);
    expect(lotRaise(holds(0), 40_000, 'SETTLED').onHoldCents).toBe(0);
    expect(lotRaise(holds(0), 40_000, 'FAILED_NEEDS_REVIEW').onHoldCents).toBe(0);
    expect(lotRaise(holds(0), null, 'WINNER_SELECTED').onHoldCents).toBe(0);
  });

  it('puts only the uncaptured remainder on hold', () => {
    expect(lotRaise(holds(10_000), 40_000, 'CAPTURING')).toEqual({
      raisedCents: 10_000,
      onHoldCents: 30_000,
    });
  });

  it('clamps the fill to 0..1 and flags a reached goal', () => {
    const half = thermometer(20_000, { raisedCents: 10_000, onHoldCents: 0 });
    expect(half?.fill).toBe(0.5);
    expect(half?.reached).toBe(false);
    const over = thermometer(20_000, { raisedCents: 30_000, onHoldCents: 0 });
    expect(over?.fill).toBe(1);
    expect(over?.reached).toBe(true);
  });

  it('adds lots into a total only when every lot has a goal', () => {
    const a = { goalCents: 10_000, raise: { raisedCents: 4_000, onHoldCents: 0 } };
    const b = { goalCents: 30_000, raise: { raisedCents: 6_000, onHoldCents: 5_000 } };
    expect(totalRaise([a, b])).toMatchObject({
      goalCents: 40_000,
      raisedCents: 10_000,
      onHoldCents: 5_000,
      fill: 0.25,
    });
    expect(totalRaise([a, { goalCents: null, raise: b.raise }])).toBeNull();
    expect(totalRaise([])).toBeNull();
  });
});
