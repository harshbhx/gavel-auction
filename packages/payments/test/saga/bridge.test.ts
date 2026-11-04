import { describe, expect, it } from 'vitest';
import { promoteIntents, roomStoreVersion } from '../../src/saga/bridge.js';

describe('bridge helpers', () => {
  const order = ['a', 'b', 'c'];

  it('promotes past every skipped leader ahead of the first planned candidate', () => {
    const intents = promoteIntents(
      'lot1',
      [
        { bidderId: 'a', priceCents: 400, reason: 'no_hold' },
        { bidderId: 'c', priceCents: 100, reason: 'price_above_hold' },
      ],
      ['b'],
      order,
    );
    expect(intents.map((i) => i.disqualifiedBidderId)).toEqual(['a']);
  });

  it('promotes every skipped bidder when nobody can be charged', () => {
    const intents = promoteIntents(
      'lot1',
      [{ bidderId: 'a', priceCents: 400, reason: 'no_hold' }],
      [],
      order,
    );
    expect(intents).toHaveLength(1);
  });

  it('maps a payments journal version to the RoomStore slot version', () => {
    expect(roomStoreVersion(0)).toBe(1);
    expect(roomStoreVersion(4)).toBe(5);
  });
});
