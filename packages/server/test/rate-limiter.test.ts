import { ManualClock } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { LIMITS, RateLimiter, limitsFromConfig, normalizePath } from '../src/limits/rate-limiter';

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

  it('limits the 41st join per minute per IP', () => {
    const { clock, rl } = setup();
    for (let i = 0; i < 40; i++) {
      expect(rl.checkJoin('1.2.3.4').ok).toBe(true);
      clock.advance(10);
    }
    expect(rl.checkJoin('1.2.3.4').ok).toBe(false);
    expect(rl.checkJoin('5.6.7.8').ok).toBe(true);
  });

  it('counts joins and HTTP calls from one IPv6 /64 together', () => {
    const { clock, rl } = setup();
    for (let i = 0; i < 40; i++) {
      expect(rl.checkJoin(`2001:db8:1:2::${i + 1}`).ok).toBe(true);
      clock.advance(10);
    }
    expect(rl.checkJoin('2001:db8:1:2:ffff::1').ok).toBe(false);
    expect(rl.checkJoin('2001:db8:1:3::1').ok).toBe(true);
    for (let i = 0; i < 60; i++)
      expect(rl.checkHttp(`2001:db8:9:9::${i + 1}`, '/api/x').ok).toBe(true);
    expect(rl.checkHttp('2001:db8:9:9:1:2:3:4', '/api/x').ok).toBe(false);
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

describe('rate limiter configuration (R-RT-120)', () => {
  it('derives the bid bucket from config', () => {
    const limits = limitsFromConfig({ RATE_BID_PER_S: 1, RATE_BID_BURST: 20 });
    expect(limits.bid).toEqual({ refillMs: 1000, burst: 20 });
    expect(limits.frame).toEqual(LIMITS.frame);
    expect(limitsFromConfig({ RATE_BID_PER_S: 3, RATE_BID_BURST: 5 }).bid).toEqual(LIMITS.bid);
  });

  it('lets a venue override the join and http buckets (R-RT-120)', () => {
    const limits = limitsFromConfig({
      RATE_BID_PER_S: 3,
      RATE_BID_BURST: 5,
      RATE_JOIN_PER_MIN: 120,
      RATE_JOIN_BURST: 300,
      RATE_HTTP_PER_MIN: 600,
      RATE_HTTP_BURST: 600,
    });
    expect(limits.join).toEqual({ refillMs: 500, burst: 300 });
    expect(limits.http).toEqual({ refillMs: 100, burst: 600 });
    const clock = new ManualClock(1_789_000_000_000);
    const rl = new RateLimiter(clock, limits);
    for (let i = 0; i < 40; i++) expect(rl.checkJoin('venue-nat').ok).toBe(true);
  });

  it('keeps the default join and http buckets when no override is set', () => {
    const limits = limitsFromConfig({ RATE_BID_PER_S: 3, RATE_BID_BURST: 5 });
    expect(limits.join).toEqual(LIMITS.join);
    expect(limits.http).toEqual(LIMITS.http);
  });

  it('honours a larger configured burst', () => {
    const clock = new ManualClock(1_789_000_000_000);
    const rl = new RateLimiter(clock, limitsFromConfig({ RATE_BID_PER_S: 3, RATE_BID_BURST: 20 }));
    for (let i = 0; i < 20; i++) expect(rl.checkBid('b1').ok).toBe(true);
    expect(rl.checkBid('b1').ok).toBe(false);
  });
});

describe('rate limiter memory and paths', () => {
  it('bounds the bucket map', () => {
    const clock = new ManualClock(1_789_000_000_000);
    const rl = new RateLimiter(clock, LIMITS, 100);
    for (let i = 0; i < 1000; i++) rl.checkFrame(`conn-${i}`);
    expect(rl.size).toBeLessThanOrEqual(100);
  });

  it('prunes idle buckets on its own as time passes', () => {
    const clock = new ManualClock(1_789_000_000_000);
    const rl = new RateLimiter(clock);
    for (let i = 0; i < 50; i++) rl.checkFrame(`conn-${i}`);
    expect(rl.size).toBe(50);
    clock.advance(120_000);
    rl.checkFrame('late');
    expect(rl.size).toBe(1);
  });

  it('normalises paths before the webhook exemption', () => {
    expect(normalizePath('/webhooks/../api/auctions/x/control')).toBe('/api/auctions/x/control');
    expect(normalizePath('/webhooks/%2e%2e/api')).toBe('/api');
    expect(normalizePath('//webhooks//paypal?x=1')).toBe('/webhooks/paypal');
    expect(normalizePath('/%zz')).toBeNull();
  });

  it('does not exempt a dot-segment path that escapes /webhooks/', () => {
    const rl = new RateLimiter(new ManualClock(1_789_000_000_000));
    for (let i = 0; i < 60; i++) rl.checkHttp('1.1.1.1', '/webhooks/../api/x');
    expect(rl.checkHttp('1.1.1.1', '/webhooks/../api/x').ok).toBe(false);
    expect(rl.checkHttp('1.1.1.1', '/webhooks/%2e%2e/api/x').ok).toBe(false);
    expect(rl.checkHttp('1.1.1.1', '/webhooks/paypal?id=1').ok).toBe(true);
  });
});

describe('rate limiter eviction (#960)', () => {
  it('does not reset an exhausted bid bucket when another kind floods the map', () => {
    const clock = new ManualClock(1_789_000_000_000);
    const rl = new RateLimiter(clock, LIMITS, 100);
    for (let i = 0; i < 5; i++) expect(rl.checkBid('b1').ok).toBe(true);
    expect(rl.checkBid('b1').ok).toBe(false);
    for (let i = 0; i < 1000; i++) rl.checkHttp(`ip-${i}`, '/x');
    expect(rl.checkBid('b1').ok).toBe(false);
  });

  it('denies new keys of a full kind instead of evicting live ones', () => {
    const clock = new ManualClock(1_789_000_000_000);
    const rl = new RateLimiter(clock, LIMITS, 10);
    for (let i = 0; i < 10; i++) rl.checkHttp(`ip-${i}`, '/x');
    for (let i = 0; i < 60; i++) rl.checkHttp('ip-0', '/x');
    expect(rl.checkHttp('ip-0', '/x').ok).toBe(false);
    expect(rl.checkHttp('new-ip', '/x').ok).toBe(false);
    expect(rl.checkHttp('ip-0', '/x').ok).toBe(false);
    expect(rl.size).toBeLessThanOrEqual(10);
  });
});
