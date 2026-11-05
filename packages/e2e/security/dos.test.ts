import { describe, expect, it } from 'vitest';
import { RateLimiter } from '@gavel/server/src/limits/rate-limiter';
import { createLlmClient, LlmUnavailableError, LLM_TIMEOUT_MS } from '@gavel/voice/src/llm/client';
import { ManualClock } from '@gavel/shared';

// T-QA-077 and T-QA-078 (R-QA-036, SEC-14): a hanging language model falls back in well under
// 4.2 s and the 61st call inside a minute is rate limited. Stub provider, injected clock, no network.
// The dependency audit gate (SEC-12) is tested in scripts/tests/check-audit.test.mjs.

const FALLBACK_BUDGET_MS = 4200;

describe('hanging language model (T-QA-077)', () => {
  it('gives up at the call timeout, long before the 4.2 s fallback budget', async () => {
    const clock = new ManualClock(1_000_000);
    const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
    const client = createLlmClient({
      mode: 'live',
      transport: () => new Promise<never>(() => undefined),
      setTimer: (fn, ms) => {
        const t = { at: clock.now() + ms, fn, live: true };
        timers.push(t);
        return () => {
          t.live = false;
        };
      },
    });
    const started = clock.now();
    const pending = client.parse(
      {
        transcript: 'paddle seven three fifty',
        currentPriceCents: 30000,
        minIncrementCents: 500,
        registeredPaddles: ['7'],
        speakerKnown: false,
        previousSegment: null,
      },
      new AbortController().signal,
    );
    const outcome = pending.then(
      () => 'ok' as const,
      (e: unknown) => e,
    );
    await new Promise<void>((r) => {
      setImmediate(r);
    });
    const timer = timers.find((t) => t.live);
    expect(timer).toBeDefined();
    clock.set(timer?.at ?? 0);
    timer?.fn();
    const err = await outcome;
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect((err as LlmUnavailableError).reason).toBe('timeout');
    expect(clock.now() - started).toBe(LLM_TIMEOUT_MS);
    expect(clock.now() - started).toBeLessThan(FALLBACK_BUDGET_MS);
    expect(client.status).toBe('down');
  });
});

describe('call cap (T-QA-078)', () => {
  it('serves 60 calls in a minute and rate limits the 61st', () => {
    const clock = new ManualClock(1_000_000);
    const limiter = new RateLimiter(clock);
    for (let i = 0; i < 60; i++) {
      expect(limiter.check('http', 'caller-1').ok).toBe(true);
    }
    const res = limiter.check('http', 'caller-1');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('rate_limited');
      expect(res.retryAfterMs).toBeGreaterThan(0);
    }
    expect(limiter.denied.http).toBe(1);
  });

  it('does not charge another caller for the first caller flood', () => {
    const clock = new ManualClock(1_000_000);
    const limiter = new RateLimiter(clock);
    for (let i = 0; i < 61; i++) limiter.check('http', 'caller-1');
    expect(limiter.check('http', 'caller-2').ok).toBe(true);
  });

  it('serves calls again once the bucket has refilled', () => {
    const clock = new ManualClock(1_000_000);
    const limiter = new RateLimiter(clock);
    for (let i = 0; i < 61; i++) limiter.check('http', 'caller-1');
    clock.advance(1000);
    expect(limiter.check('http', 'caller-1').ok).toBe(true);
  });
});
