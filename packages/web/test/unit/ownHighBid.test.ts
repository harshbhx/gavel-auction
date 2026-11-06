import { Cents } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { initialRoomState, reduce } from '../../src/store/roomReducer';
import { selectCeilingUsage, selectMyStatus } from '../../src/store/selectors';
import { bidderId, openSnapshot, roster, stateMsg } from '../../src/testing/builders';

const AUCTION = '';

function freshStoreWithSnapshot(highBid: number | undefined) {
  const snap = {
    ...openSnapshot(roster([1, 'A'], [2, 'B'])),
    price: Cents(40_000),
    leaderId: bidderId(2),
    minNext: Cents(41_000),
    you: {
      bidderId: bidderId(1),
      ceiling: Cents(50_000),
      ...(highBid === undefined ? {} : { highBid: Cents(highBid) }),
    },
  };
  return reduce(initialRoomState(AUCTION), { kind: 'wire', msg: stateMsg(1, snap) }).state;
}

describe('own high bid after a reload', () => {
  it('reads outbid and the used ceiling from the snapshot alone', () => {
    const state = freshStoreWithSnapshot(30_000);
    expect(selectMyStatus(state)).toBe('outbid');
    expect(selectCeilingUsage(state)).toEqual({ usedCents: 30_000, maxCents: 50_000 });
  });

  it('still reads none when the snapshot has no own bid', () => {
    const state = freshStoreWithSnapshot(undefined);
    expect(selectMyStatus(state)).toBe('none');
    expect(selectCeilingUsage(state)).toEqual({ usedCents: 0, maxCents: 50_000 });
  });
});
