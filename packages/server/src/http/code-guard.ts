import { createHash } from 'node:crypto';
import { clientKey } from '@gavel/shared';
import type { HttpDeps } from './app';

/** Limits on guessing room codes. Judge rooms use them for the open join (SRV-30). */
export interface CodeGuardLimits {
  /** Join attempts one source address may make per minute, right or wrong. */
  attemptsPerIpPerMin: number;
  /** Wrong codes one source address may try before it is locked out. */
  wrongCodesBeforeLockout: number;
  /** How long a locked-out address is refused, in ms. */
  lockoutMs: number;
}

export const CODE_GUARD_DEFAULTS: CodeGuardLimits = {
  attemptsPerIpPerMin: 10,
  wrongCodesBeforeLockout: 5,
  lockoutMs: 15 * 60_000,
};

/** A code lookup (`GET /api/auctions/<CODE>`) is cheaper than a join, so it gets a wider window. */
const LOOKUP_ATTEMPT_FACTOR = 3;
const MINUTE_MS = 60_000;
const SAME_CODE_MS = 5_000;
const MAX_TRACKED = 5_000;

/** A short stable tag for a source address, so neither audit nor state holds the address itself. */
export function sourceTag(source: string): string {
  return createHash('sha256').update(clientKey(source)).digest('hex').slice(0, 12);
}

export type GuardVerdict =
  | { ok: true }
  | { ok: false; reason: 'locked' | 'rate'; retryAfterS: number };

export type GuardKind = 'join' | 'lookup';

/**
 * Throttle for anything that turns a short room code into a room: the open join and the public
 * code lookup share one set of wrong-code strikes, so guessing through either door locks both.
 */
export class CodeGuard {
  limits: CodeGuardLimits;
  private readonly attempts = new Map<string, number[]>();
  private readonly wrong = new Map<
    string,
    {
      count: number;
      since: number;
      lockedUntil: number;
      last?: string;
      lastAt?: number;
      lastKind?: GuardKind;
    }
  >();

  constructor(limits: Partial<CodeGuardLimits> = {}) {
    this.limits = { ...CODE_GUARD_DEFAULTS, ...limits };
  }

  private prune(now: number): void {
    if (this.attempts.size > MAX_TRACKED) {
      for (const [k, v] of this.attempts) {
        if (v.every((t) => now - t >= MINUTE_MS)) this.attempts.delete(k);
      }
    }
    if (this.wrong.size > MAX_TRACKED) {
      for (const [k, v] of this.wrong) {
        if (v.lockedUntil <= now && now - v.since >= this.limits.lockoutMs) this.wrong.delete(k);
      }
    }
  }

  /** Seconds left of a source's lockout, or 0 when it is not locked out. Counts nothing. */
  lockedFor(tag: string, now: number): number {
    const strikes = this.wrong.get(tag);
    return strikes !== undefined && strikes.lockedUntil > now
      ? Math.max(1, Math.ceil((strikes.lockedUntil - now) / 1000))
      : 0;
  }

  /** Checks the lockout and the attempt rate for a source and counts the attempt. */
  attempt(tag: string, now: number, kind: GuardKind = 'join'): GuardVerdict {
    this.prune(now);
    const strikes = this.wrong.get(tag);
    if (strikes !== undefined && strikes.lockedUntil > now) {
      return {
        ok: false,
        reason: 'locked',
        retryAfterS: Math.max(1, Math.ceil((strikes.lockedUntil - now) / 1000)),
      };
    }
    // Join and lookup keep separate windows, so reading a room never uses up a join.
    const key = `${kind}:${tag}`;
    const recent = (this.attempts.get(key) ?? []).filter((t) => now - t < MINUTE_MS);
    const cap =
      kind === 'lookup'
        ? this.limits.attemptsPerIpPerMin * LOOKUP_ATTEMPT_FACTOR
        : this.limits.attemptsPerIpPerMin;
    if (recent.length >= cap) {
      this.attempts.set(key, recent);
      return { ok: false, reason: 'rate', retryAfterS: 60 };
    }
    recent.push(now);
    this.attempts.set(key, recent);
    return { ok: true };
  }

  /**
   * Gives back the attempt `attempt` just counted, because the code turned out to be a real room.
   * Only misses stay in the per-minute budget, so brute force is still capped while a room of
   * judges behind one address can look up a real code as often as they like. The lockout is not
   * touched: wrong codes still strike.
   */
  release(tag: string, now: number, kind: GuardKind = 'join'): void {
    const recent = this.attempts.get(`${kind}:${tag}`);
    if (recent === undefined) return;
    const at = recent.lastIndexOf(now);
    if (at >= 0) recent.splice(at, 1);
    else recent.pop();
  }

  /**
   * Counts one wrong code for the source; the Nth one starts the lockout. The same code sent
   * again within a few seconds through the other door (a lookup, then a join with one typo) is one
   * strike, not two. The same door twice is two guesses.
   */
  noteWrong(tag: string, now: number, code?: string, kind: GuardKind = 'join'): void {
    const prev = this.wrong.get(tag);
    const mark = code === undefined ? undefined : createHash('sha256').update(code).digest('hex');
    if (
      prev !== undefined &&
      mark !== undefined &&
      prev.last === mark &&
      prev.lastKind !== kind &&
      prev.lastAt !== undefined &&
      now - prev.lastAt < SAME_CODE_MS
    ) {
      return;
    }
    const fresh =
      prev === undefined || (prev.lockedUntil <= now && now - prev.since >= this.limits.lockoutMs);
    const next: {
      count: number;
      since: number;
      lockedUntil: number;
      last?: string;
      lastAt?: number;
      lastKind?: GuardKind;
    } = fresh ? { count: 0, since: now, lockedUntil: 0 } : { ...prev };
    if (mark !== undefined) {
      next.last = mark;
      next.lastAt = now;
      next.lastKind = kind;
    }
    next.count += 1;
    if (next.count >= this.limits.wrongCodesBeforeLockout) {
      next.lockedUntil = now + this.limits.lockoutMs;
    }
    this.wrong.set(tag, next);
  }
}

const guards = new WeakMap<HttpDeps, CodeGuard>();

/** The one guard of a host: judge rooms and the public lookup get the same object. */
export function codeGuardOf(deps: HttpDeps, limits?: Partial<CodeGuardLimits>): CodeGuard {
  let guard = guards.get(deps);
  if (guard === undefined) {
    guard = new CodeGuard(limits);
    guards.set(deps, guard);
  } else if (limits !== undefined) {
    guard.limits = { ...CODE_GUARD_DEFAULTS, ...limits };
  }
  return guard;
}
