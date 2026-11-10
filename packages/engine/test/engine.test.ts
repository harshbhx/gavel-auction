import { describe, expect, it } from 'vitest';
import { Auction, Rejected } from '../src/engine';

function setup(mode: 'english' | 'proxy' | 'second_price' = 'english') {
  const a = new Auction('a1', { mode, reserve: 100, minIncrement: 50, endTs: 100 });
  a.register('ann', 10_000);
  a.register('bob', 5_000);
  return a;
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof Rejected) return e.code;
    throw e;
  }
  return 'none';
}

describe('english', () => {
  it('winner pays the top bid and others lose', () => {
    const a = setup();
    a.placeBid('ann', 200, 1);
    a.placeBid('bob', 300, 2);
    a.placeBid('ann', 400, 3);
    const out = a.hammer(100);
    expect(out.winner).toBe('ann');
    expect(out.price).toBe(400);
    expect(a.state).toBe('SETTLING');
    a.complete();
    expect(a.state).toBe('DONE');
  });

  it('enforces increment, ceiling, reserve and leader rules', () => {
    const a = setup();
    a.placeBid('ann', 200, 1);
    expect(code(() => a.placeBid('bob', 220, 2))).toBe('below_increment');
    expect(code(() => a.placeBid('bob', 6_000, 2))).toBe('over_ceiling');
    expect(code(() => a.placeBid('ann', 400, 2))).toBe('already_leading');
    expect(code(() => a.placeBid('zed', 400, 2))).toBe('unregistered');
    expect(code(() => a.placeBid('bob', 50, 2))).toBe('below_reserve');
  });

  it('rejects bids after the end and handles no-bid auctions', () => {
    const a = setup();
    expect(code(() => a.placeBid('ann', 200, 100))).toBe('closed');
    const out = a.hammer(100);
    expect(out.winner).toBeNull();
    expect(out.price).toBe(0);
  });

  it('soft close extends the end time, capped', () => {
    const a = new Auction('s', {
      reserve: 1,
      minIncrement: 1,
      endTs: 100,
      softCloseWindow: 10,
      softCloseExtension: 10,
      maxExtensions: 2,
    });
    a.register('ann', 1_000);
    a.register('bob', 1_000);
    a.placeBid('ann', 10, 95);
    expect(a.endTs).toBe(105);
    a.placeBid('bob', 20, 104);
    expect(a.endTs).toBe(114);
    a.placeBid('ann', 30, 113);
    expect(a.endTs).toBe(114);
    expect(a.extensions).toBe(2);
  });
});

describe('proxy', () => {
  it('price is second max plus increment, capped by top max', () => {
    const a = setup('proxy');
    a.placeBid('ann', 1_000, 1);
    expect(a.price()).toBe(100);
    a.placeBid('bob', 400, 2);
    expect(a.price()).toBe(450);
    expect(a.hammer(100).price).toBe(450);
  });
});

describe('second_price', () => {
  it('winner pays the second-highest bid, one bid each', () => {
    const a = setup('second_price');
    a.placeBid('ann', 4_000, 1);
    a.placeBid('bob', 2_500, 2);
    expect(code(() => a.placeBid('bob', 3_000, 3))).toBe('already_bid');
    expect(a.price()).toBeNull();
    const out = a.hammer(100);
    expect(out.winner).toBe('ann');
    expect(out.price).toBe(2_500);
  });

  it('single bidder pays the reserve; ties go to the earliest bid', () => {
    const a = setup('second_price');
    a.placeBid('bob', 3_000, 1);
    expect(a.hammer(100).price).toBe(100);
    const b = setup('second_price');
    b.placeBid('ann', 3_000, 1);
    b.placeBid('bob', 3_000, 2);
    expect(b.hammer(100).winner).toBe('ann');
  });
});

describe('invariants', () => {
  it('price never exceeds the winner ceiling across random auctions', () => {
    let s = 12345;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 300; i++) {
      const modes = ['english', 'proxy', 'second_price'] as const;
      const mode = modes[i % 3] ?? 'english';
      const a = new Auction(`r${i}`, { mode, reserve: 10, minIncrement: 5, endTs: 1000 });
      const names = ['a', 'b', 'c', 'd'];
      for (const n of names) a.register(n, 100 + Math.floor(rnd() * 900));
      for (let t = 1; t < 60; t++) {
        try {
          a.placeBid(names[Math.floor(rnd() * 4)] ?? 'a', 1 + Math.floor(rnd() * 1000), t);
        } catch (e) {
          if (!(e instanceof Rejected)) throw e;
        }
      }
      const out = a.hammer(1000);
      if (out.winner) expect(out.price).toBeLessThanOrEqual(a.ceilings.get(out.winner) ?? 0);
    }
    // 300 auctions take about 1 s plain and several times that under v8 coverage (vitest 4).
  }, 60_000);
});
