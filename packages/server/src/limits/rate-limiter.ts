import type { Clock } from '@gavel/shared';

export type LimitKind = 'bid' | 'frame' | 'join' | 'http';

export interface BucketSpec {
  /** Milliseconds to earn one token (integer, so refills are exact). */
  readonly refillMs: number;
  readonly burst: number;
}

/** R-RT-120: bids 3/s burst 5; frames 20/s burst 40; joins 10/min; HTTP 60/min. */
export const LIMITS: Readonly<Record<LimitKind, BucketSpec>> = {
  bid: { refillMs: 333, burst: 5 },
  frame: { refillMs: 50, burst: 40 },
  join: { refillMs: 6000, burst: 10 },
  http: { refillMs: 1000, burst: 60 },
};

export type RateResult = { ok: true } | { ok: false; code: 'rate_limited'; retryAfterMs: number };

interface Bucket {
  tokens: number;
  lastMs: number;
}

/** Routes that are never limited. */
const EXEMPT_PREFIXES: readonly string[] = ['/webhooks/'];

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  /** Count of denials per kind, for metrics (R-RT-122). */
  readonly denied: Record<LimitKind, number> = { bid: 0, frame: 0, join: 0, http: 0 };

  constructor(
    private readonly clock: Clock,
    private readonly limits: Readonly<Record<LimitKind, BucketSpec>> = LIMITS,
  ) {}

  /** Take one token from the bucket for `kind` and `key`. No state besides the bucket changes. */
  check(kind: LimitKind, key: string): RateResult {
    const spec = this.limits[kind];
    const now = this.clock.now();
    const id = `${kind}:${key}`;
    let b = this.buckets.get(id);
    if (!b) {
      b = { tokens: spec.burst, lastMs: now };
      this.buckets.set(id, b);
    }
    const earned = Math.floor(Math.max(0, now - b.lastMs) / spec.refillMs);
    if (earned > 0) {
      b.tokens = Math.min(spec.burst, b.tokens + earned);
      b.lastMs = b.tokens >= spec.burst ? now : b.lastMs + earned * spec.refillMs;
    } else if (b.tokens >= spec.burst) {
      b.lastMs = now;
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true };
    }
    this.denied[kind] += 1;
    return {
      ok: false,
      code: 'rate_limited',
      retryAfterMs: Math.max(1, spec.refillMs - (now - b.lastMs)),
    };
  }

  checkBid(bidderId: string): RateResult {
    return this.check('bid', bidderId);
  }

  checkFrame(connId: string): RateResult {
    return this.check('frame', connId);
  }

  checkJoin(ip: string): RateResult {
    return this.check('join', ip);
  }

  /** HTTP limit per IP; webhook routes are exempt. */
  checkHttp(ip: string, path: string): RateResult {
    if (EXEMPT_PREFIXES.some((p) => path.startsWith(p))) return { ok: true };
    return this.check('http', ip);
  }

  /** Drop buckets that have fully refilled, to bound memory. */
  sweep(): void {
    const now = this.clock.now();
    for (const [id, b] of this.buckets) {
      const kind = id.slice(0, id.indexOf(':')) as LimitKind;
      const spec = this.limits[kind];
      if (b.tokens + Math.floor((now - b.lastMs) / spec.refillMs) >= spec.burst) {
        this.buckets.delete(id);
      }
    }
  }
}
