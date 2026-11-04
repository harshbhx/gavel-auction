import { SETTLEMENT_EDGES } from '@gavel/engine';
import { describe, expect, it } from 'vitest';
import { allowedTransitions } from '../../src/saga/machine.js';

describe('settlement edges', () => {
  it('the engine accepts exactly the edges the saga machine can take (ENG-R3-06)', () => {
    const saga = new Set(allowedTransitions().map((t) => `${t.from}>${t.to}`));
    const engine = new Set(SETTLEMENT_EDGES.map(([f, t]) => `${f}>${t}`));
    expect([...engine].sort()).toEqual([...saga].sort());
  });
});
