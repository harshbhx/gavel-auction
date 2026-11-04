import { describe, expect, it } from 'vitest';
import { SeqIds, UlidMinter, type Ids, type RandomBytes } from '../src/ids-mint';
import { isUlid } from '../src/ids';
import { ManualClock } from '../src/time';

const seeded = (seed: number): RandomBytes => {
  let s = seed;
  return (buf) => {
    for (let i = 0; i < buf.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      buf[i] = s >>> 24;
    }
  };
};

describe('UlidMinter (T-RT-002)', () => {
  it('mints 10_000 strictly increasing unique ids under a frozen clock', () => {
    const minter = new UlidMinter(new ManualClock(1_789_000_000_000), seeded(7));
    const ids: string[] = [];
    for (let i = 0; i < 10_000; i++) ids.push(minter.mint());
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    for (let i = 1; i < ids.length; i++) expect((ids[i] ?? '') > (ids[i - 1] ?? '')).toBe(true);
    expect(ids.every((id) => isUlid(id))).toBe(true);
  });

  it('stays increasing when the clock moves backwards', () => {
    const clock = new ManualClock(2000);
    const minter = new UlidMinter(clock, seeded(1));
    const a = minter.mint();
    clock.set(1000);
    const b = minter.mint();
    expect(b > a).toBe(true);
  });

  it('sorts by time across milliseconds', () => {
    const clock = new ManualClock(1000);
    const minter = new UlidMinter(clock, seeded(3));
    const a = minter.mint();
    clock.advance(1);
    const b = minter.mint();
    expect(b > a).toBe(true);
  });

  it('moves to the next millisecond when the random part overflows', () => {
    const maxRandom: RandomBytes = (buf) => buf.fill(31);
    const minter = new UlidMinter(new ManualClock(5), maxRandom);
    const a = minter.mint();
    const b = minter.mint();
    expect(b > a).toBe(true);
    expect(isUlid(b)).toBe(true);
  });
});

describe('SeqIds (T-RT-003)', () => {
  it('yields deterministic sequential ids and implements Ids', () => {
    const ids: Ids = new SeqIds();
    expect(ids.mint()).toBe('01TEST00000000000000000001');
    expect(ids.mint()).toBe('01TEST00000000000000000002');
    expect(new SeqIds().mint()).toBe('01TEST00000000000000000001');
  });

  it('produces valid ULIDs', () => {
    expect(isUlid(new SeqIds().mint())).toBe(true);
  });
});

describe('SeqIds beyond 9999 (T-RT-003)', () => {
  it('keeps minting valid ids for a long load run', () => {
    const ids = new SeqIds();
    let last = '';
    for (let i = 0; i < 20_000; i++) last = ids.mint();
    expect(last).toBe('01TEST00000000000000020000');
    expect(isUlid(last)).toBe(true);
  });
});
