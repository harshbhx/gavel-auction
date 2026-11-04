import { describe, expect, it } from 'vitest';
import { initialRoomState, reduce } from '../../src/store/roomReducer';
import { openSnapshot, roster, stateMsg } from '../../src/testing/builders';
import { timed } from '../support/stopwatch';

const BIDDERS = 200;
const RUNS = 200;
/** Median budget in ms: 1 ms locally, 5x on CI (T-WEB-062). */
const BUDGET_MS = process.env['CI'] === undefined || process.env['CI'] === '' ? 1 : 5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

describe('reducer benchmark', () => {
  it(`reduces a ${BIDDERS}-bidder snapshot in under ${BUDGET_MS} ms (median)`, () => {
    const list = roster(
      ...Array.from({ length: BIDDERS }, (_, i): [number, string] => [i + 1, `Bidder ${i + 1}`]),
    );
    const times: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const msg = stateMsg(run + 1, openSnapshot(list));
      const { value, ms } = timed(() => reduce(initialRoomState(''), { kind: 'wire', msg }));
      times.push(ms);
      expect(value.state.snapshot?.roster).toHaveLength(BIDDERS);
    }
    expect(median(times)).toBeLessThan(BUDGET_MS);
  });
});
