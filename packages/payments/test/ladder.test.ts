import { describe, expect, it } from 'vitest';
import { ladderStep } from '../src/ladder.js';
import type { HoldStatus } from '../src/types.js';

describe('ladderStep', () => {
  const cases: Array<[HoldStatus, string, string]> = [
    ['HELD', 'held', 'Held, not charged'],
    ['CAPTURED', 'charged', 'Charged at winning price'],
    ['VOIDED', 'released', 'Released'],
    ['EXPIRED', 'released', 'Released'],
    ['DENIED', 'declined', 'Declined'],
    ['UNKNOWN', 'checking', 'Checking'],
    ['PENDING_APPROVAL', 'checking', 'Checking'],
  ];
  for (const [status, step, label] of cases) {
    it(`${status} -> ${step}`, () => {
      expect(ladderStep(status, 'BIDDING')).toEqual({ step, label });
    });
  }

  it('shows a leftover HELD loser as released and an unknown role as checking once settled', () => {
    expect(ladderStep('HELD', 'SETTLED', 'other').step).toBe('released');
    expect(ladderStep('HELD', 'SETTLED').step).toBe('checking');
  });

  it('never shows the charged winner as released while their hold record lags', () => {
    expect(ladderStep('HELD', 'SETTLED', 'winner')).toEqual({
      step: 'charged',
      label: 'Charged at winning price',
    });
    expect(ladderStep('UNKNOWN', 'SETTLED', 'winner').step).toBe('charged');
    expect(ladderStep('CAPTURED', 'SETTLED', 'winner').step).toBe('charged');
  });

  it('shows open holds as checking while the settlement needs review', () => {
    expect(ladderStep('HELD', 'FAILED_NEEDS_REVIEW').step).toBe('checking');
    expect(ladderStep('CAPTURED', 'FAILED_NEEDS_REVIEW').step).toBe('charged');
  });

  it('works without a settlement state', () => {
    expect(ladderStep('HELD').step).toBe('held');
  });
});
