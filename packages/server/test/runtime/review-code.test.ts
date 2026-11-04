import { EngineError, InvariantError } from '@gavel/engine';
import { BridgeError } from '@gavel/payments';
import { describe, expect, it } from 'vitest';
import { reviewCodeOf } from '../../src/runtime/review-code';

describe('reviewCodeOf (ENG-R3-14)', () => {
  it('turns rule failures of the engine and the bridge into a code', () => {
    expect(reviewCodeOf(new EngineError('capture_mismatch'))).toBe('capture_mismatch');
    expect(reviewCodeOf(new InvariantError('captured_over_ceiling'))).toBe('captured_over_ceiling');
    expect(reviewCodeOf(new BridgeError('winner_mismatch', 'x'))).toBe('winner_mismatch');
  });

  it('leaves other failures to be retried', () => {
    expect(reviewCodeOf(new Error('socket hang up'))).toBeUndefined();
  });
});
