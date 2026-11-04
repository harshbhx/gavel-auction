import { ManualClock } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/limits/rate-limiter';

const setup = () => {
  const clock = new ManualClock(1_789_000_000_000);
  return { clock, rl: new RateLimiter(clock) };
};

describe('rate limiter (T-RT-086)', () => {
  it('allows a burst of 5 bids, limits the 6th, isolates bidders, refills at 333 ms', () => {
    const { clock, rl } = setup();
    const start = clock.now();
    for (let i = 0; i < 5; i++) {
      expect(rl.checkBid('b1').ok).toBe(true);
      clock.advance(20);
    }
    // 100 ms after the first bid
    clock.set(start + 100);
    const sixth = rl.checkBid('b1');
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) {
      expect(sixth.code).toBe('rate_limited');
      expect(sixth.retryAfterMs).toBeGreaterThan(0);
    }
    expect(rl.checkBid('b2').ok).toBe(true);
    clock.set(start + 332);
    expect(rl.checkBid('b1').ok).toBe(false);
    clock.set(start + 333);
    expect(rl.checkBid('b1').ok).toBe(true);
    expect(rl.checkBid('b1').ok).toBe(false);
    expect(rl.denied.bid).toBe(3);
  });

  it('full bucket never exceeds burst after a long idle', () => {
    const { clock, rl } = setup();
    expect(rl.checkBid('b1').ok).toBe(true);
    clock.advance(3_600_000);
    for (let i = 0; i < 5; i++) expect(rl.checkBid('b1').ok).toBe(true);
    expect(rl.checkBid('b1').ok).toBe(false);
  });
});

describe('rate limiter (T-RT-087)', () => {
  it('limits the 41st frame in one second per connection', () => {
    const { clock, rl } = setup();
    let allowed = 0;
    for (let i = 0; i < 41; i++) {
      if (rl.checkFrame('c1').ok) allowed += 1;
      clock.advance(1);
    }
    expect(allowed).toBe(40);
    expect(rl.checkFrame('c2').ok).toBe(true);
  });

  it('limits the 11th join per minute per IP', () => {
    const { clock, rl } = setup();
    for (let i = 0; i < 10; i++) {
      expect(rl.checkJoin('1.2.3.4').ok).toBe(true);
      clock.advance(100);
    }
    expect(rl.checkJoin('1.2.3.4').ok).toBe(false);
    expect(rl.checkJoin('5.6.7.8').ok).toBe(true);
  });

  it('limits HTTP at 60 per IP but exempts webhooks', () => {
    const { rl } = setup();
    for (let i = 0; i < 60; i++) expect(rl.checkHttp('1.1.1.1', '/api/x').ok).toBe(true);
    expect(rl.checkHttp('1.1.1.1', '/api/x').ok).toBe(false);
    for (let i = 0; i < 200; i++) {
      expect(rl.checkHttp('1.1.1.1', '/webhooks/paypal').ok).toBe(true);
    }
  });

  it('sweep drops refilled buckets', () => {
    const { clock, rl } = setup();
    rl.checkBid('b1');
    clock.advance(5000);
    rl.sweep();
    for (let i = 0; i < 5; i++) expect(rl.checkBid('b1').ok).toBe(true);
    expect(rl.checkBid('b1').ok).toBe(false);
  });
});
