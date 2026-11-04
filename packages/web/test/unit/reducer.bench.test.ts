import { describe, expect, it } from 'vitest';
import { initialRoomState, reduce } from '../../src/store/roomReducer';
import type { BidderView, StateMessage } from '../../src/wire';

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
    const bidders: BidderView[] = Array.from({ length: BIDDERS }, (_, i) => ({
      paddle: i + 1,
      name: `Bidder ${i + 1}`,
      holdState: 'HELD',
      ceilingCents: 100_000,
    }));
    const times: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const msg: StateMessage = {
        t: 'state',
        seq: run + 1,
        roomId: 'r',
        serverTime: run,
        room: {
          id: 'r',
          name: 'Room',
          status: 'OPEN',
          config: {
            minIncrementCents: 1_000,
            reserveCents: 0,
            softCloseMs: 10_000,
            maxCeilingCents: 100_000,
            minCeilingCents: 5_000,
            lateEntry: true,
            mode: 'english',
          },
        },
        lot: { id: 'lot', title: 'Lot' },
        price: { currentCents: 1_000, leaderPaddle: 1, nextMinCents: 2_000, bidCount: run },
        bidders,
      };
      const start = performance.now();
      const result = reduce(initialRoomState('r'), { kind: 'wire', msg });
      times.push(performance.now() - start);
      expect(result.state.snapshot?.bidders).toHaveLength(BIDDERS);
    }
    expect(median(times)).toBeLessThan(BUDGET_MS);
  });
});
