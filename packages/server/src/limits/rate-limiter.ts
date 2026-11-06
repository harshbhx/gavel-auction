import { clientKey, type Clock } from '@gavel/shared';

export type LimitKind = 'bid' | 'frame' | 'join' | 'http';

export interface BucketSpec {
  /** Milliseconds to earn one token (integer, so refills are exact). */
  readonly refillMs: number;
  readonly burst: number;
}

/** R-RT-120: bids 3/s burst 5; frames 20/s burst 40; joins 10/min burst 40; HTTP 60/min. */
export const LIMITS: Readonly<Record<LimitKind, BucketSpec>> = {
  bid: { refillMs: 333, burst: 5 },
  frame: { refillMs: 50, burst: 40 },
  join: { refillMs: 6000, burst: 40 },
  http: { refillMs: 1000, burst: 60 },
};

/**
 * Limits with the bid bucket taken from config (RATE_BID_PER_S, RATE_BID_BURST).
 * The refill period is whole milliseconds, rounded down, so 3/s gives 333 ms.
 */
export function limitsFromConfig(cfg: {
  RATE_BID_PER_S: number;
  RATE_BID_BURST: number;
  RATE_JOIN_PER_MIN?: number;
  RATE_JOIN_BURST?: number;
  RATE_HTTP_PER_MIN?: number;
  RATE_HTTP_BURST?: number;
}): Readonly<Record<LimitKind, BucketSpec>> {
  const perMin = (rate: number): number => Math.max(1, Math.floor(60_000 / rate));
  return {
    ...LIMITS,
    join: {
      refillMs: cfg.RATE_JOIN_PER_MIN ? perMin(cfg.RATE_JOIN_PER_MIN) : LIMITS.join.refillMs,
      burst: cfg.RATE_JOIN_BURST ?? LIMITS.join.burst,
    },
    http: {
      refillMs: cfg.RATE_HTTP_PER_MIN ? perMin(cfg.RATE_HTTP_PER_MIN) : LIMITS.http.refillMs,
      burst: cfg.RATE_HTTP_BURST ?? LIMITS.http.burst,
    },
    bid: {
      refillMs: Math.max(1, Math.floor(1000 / cfg.RATE_BID_PER_S)),
      burst: cfg.RATE_BID_BURST,
    },
  };
}

/** Upper bound on live buckets per kind; a kind at its cap refuses new keys. */
export const MAX_BUCKETS = 50_000;
/** How often idle buckets are pruned, in clock milliseconds. */
const SWEEP_EVERY_MS = 60_000;

/**
 * Canonical form of a request path for the exemption check: query and fragment
 * removed, percent escapes decoded, backslashes treated as slashes, empty and
 * dot segments resolved. Returns null when the path cannot be decoded.
 */
export function normalizePath(raw: string): string | null {
  let path = raw.split(/[?#]/, 1)[0] ?? '';
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  const out: string[] = [];
  for (const seg of path.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return '/' + out.join('/');
}

export type RateResult = { ok: true } | { ok: false; code: 'rate_limited'; retryAfterMs: number };

interface Bucket {
  tokens: number;
  lastMs: number;
}

/** Routes that are never limited. */
const EXEMPT_PREFIXES: readonly string[] = ['/webhooks/'];

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly counts: Record<LimitKind, number> = { bid: 0, frame: 0, join: 0, http: 0 };
  /** Count of denials per kind, for metrics (R-RT-122). */
  readonly denied: Record<LimitKind, number> = { bid: 0, frame: 0, join: 0, http: 0 };

  constructor(
    private readonly clock: Clock,
    private readonly limits: Readonly<Record<LimitKind, BucketSpec>> = LIMITS,
    private readonly maxBuckets: number = MAX_BUCKETS,
  ) {
    this.lastSweepMs = clock.now();
  }

  private lastSweepMs: number;

  /** Number of live buckets (for metrics and tests). */
  get size(): number {
    return this.buckets.size;
  }

  /** Take one token from the bucket for `kind` and `key`. No state besides the bucket changes. */
  check(kind: LimitKind, key: string): RateResult {
    const spec = this.limits[kind];
    const now = this.clock.now();
    const id = `${kind}:${key}`;
    if (now - this.lastSweepMs >= SWEEP_EVERY_MS) this.sweep();
    let b = this.buckets.get(id);
    if (!b) {
      if (!this.makeRoom(kind)) {
        // Full of live buckets: refuse the new key instead of evicting someone else's (R-RT-120).
        this.denied[kind] += 1;
        return { ok: false, code: 'rate_limited', retryAfterMs: spec.refillMs };
      }
      b = { tokens: spec.burst, lastMs: now };
      this.buckets.set(id, b);
      this.counts[kind] += 1;
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
    return this.check('join', clientKey(ip));
  }

  /** HTTP limit per IP; webhook routes are exempt. */
  checkHttp(ip: string, path: string): RateResult {
    const normal = normalizePath(path);
    if (normal !== null && EXEMPT_PREFIXES.some((p) => normal.startsWith(p))) return { ok: true };
    return this.check('http', clientKey(ip));
  }

  /** Drop buckets that have fully refilled, to bound memory. */
  sweep(): void {
    const now = this.clock.now();
    this.lastSweepMs = now;
    for (const [id, b] of this.buckets) {
      const kind = id.slice(0, id.indexOf(':')) as LimitKind;
      const spec = this.limits[kind];
      if (b.tokens + Math.floor((now - b.lastMs) / spec.refillMs) >= spec.burst) {
        this.buckets.delete(id);
        this.counts[kind] -= 1;
      }
    }
  }

  /** Make space for one bucket of `kind`: prune idle ones only. False when the kind is full. */
  private makeRoom(kind: LimitKind): boolean {
    if (this.counts[kind] < this.maxBuckets) return true;
    this.sweep();
    return this.counts[kind] < this.maxBuckets;
  }
}
