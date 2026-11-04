import { describe, expect, it } from 'vitest';
import { canonicalJson, SETTLEMENT_STATES, type SettlementState } from '../src/types.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expected =
  | 'HELD'
  | 'BIDDING'
  | 'WINNER_SELECTED'
  | 'CAPTURING'
  | 'FALLBACK_RUNNER_UP'
  | 'CAPTURED'
  | 'VOIDING'
  | 'SETTLED'
  | 'FAILED_NEEDS_REVIEW';
const stateUnionIsExact: Equal<SettlementState, Expected> = true;

describe('types', () => {
  it('SettlementState is exactly the nine fixed names', () => {
    expect(stateUnionIsExact).toBe(true);
    expect([...SETTLEMENT_STATES]).toHaveLength(9);
  });

  it('canonicalJson sorts keys recursively and omits undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[{"y":2,"z":1}]},"b":1}',
    );
  });
});
