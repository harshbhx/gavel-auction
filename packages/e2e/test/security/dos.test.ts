import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualClock } from '@gavel/shared';
import { RateLimiter } from '@gavel/server/src/limits/rate-limiter';
import {
  LLM_TIMEOUT_MS,
  createLlmClient,
  LlmUnavailableError,
} from '../../../voice/src/llm/client';
import { createFakeTransport } from '../../../voice/src/llm/fake';
// @ts-expect-error plain script without type declarations
import { MAX_WAIVER_DAYS, evaluate } from '../../../../scripts/check-audit.mjs';

// T-QA-077 and T-QA-078 (R-QA-036): the audit gate passes or is waived and expires, a hanging
// language model gives way to the rules well inside 4.2 s, and the 61st HTTP call in a minute is
// rate limited. The model is a stub; no provider is called.

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'check-audit.mjs');
const FALLBACK_BUDGET_MS = 4200;
const NOW = Date.parse('2026-11-05T00:00:00Z');

interface Report {
  vulnerabilities: Record<string, unknown>;
}

const advisory = (id: string, severity: string): Report => ({
  vulnerabilities: {
    leftpad: {
      name: 'leftpad',
      severity,
      via: [{ source: 1, url: `https://github.com/advisories/${id}`, severity }],
    },
  },
});

describe('audit gate with expiring waivers (T-QA-077)', () => {
  it('passes a clean report', () => {
    expect(evaluate({ vulnerabilities: {} }, [], { nowMs: NOW }).failures).toEqual([]);
  });

  it('fails an unwaived high advisory and ignores one below the level', () => {
    expect(
      evaluate(advisory('GHSA-aaaa-bbbb-cccc', 'high'), [], { nowMs: NOW }).failures,
    ).toHaveLength(1);
    expect(
      evaluate(advisory('GHSA-aaaa-bbbb-cccc', 'moderate'), [], { nowMs: NOW }).failures,
    ).toEqual([]);
  });

  it('passes an advisory covered by a waiver that has not expired', () => {
    const waivers = [
      { advisory: 'GHSA-aaaa-bbbb-cccc', reason: 'dev only', expires: '2026-12-01' },
    ];
    const res = evaluate(advisory('GHSA-aaaa-bbbb-cccc', 'critical'), waivers, { nowMs: NOW });
    expect(res.failures).toEqual([]);
    expect(res.waived).toEqual(['leftpad']);
  });

  it('fails once the waiver has expired, even for an advisory it still covers', () => {
    const waivers = [
      { advisory: 'GHSA-aaaa-bbbb-cccc', reason: 'dev only', expires: '2026-12-01' },
    ];
    const later = Date.parse('2026-12-02T00:00:00Z');
    const res = evaluate(advisory('GHSA-aaaa-bbbb-cccc', 'high'), waivers, { nowMs: later });
    expect(res.failures.length).toBeGreaterThanOrEqual(2);
    expect(res.failures.join('\n')).toContain('expired');
  });

  it('fails a waiver without a reason, with a bad date or with a lifetime past the cap', () => {
    const report = { vulnerabilities: {} };
    const bad = [
      { advisory: 'GHSA-a', reason: '', expires: '2026-12-01' },
      { advisory: 'GHSA-b', reason: 'x', expires: 'soon' },
      { advisory: 'GHSA-c', reason: 'x', expires: '2030-01-01' },
    ];
    for (const w of bad) {
      expect(evaluate(report, [w], { nowMs: NOW }).failures, JSON.stringify(w)).toHaveLength(1);
    }
    expect(MAX_WAIVER_DAYS).toBeLessThanOrEqual(90);
  });

  describe('as a command', () => {
    const dirs: string[] = [];
    afterEach(() => {
      for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    });

    function run(report: Report, waivers: unknown[], now: string) {
      const dir = mkdtempSync(join(tmpdir(), 'gavel-audit-'));
      dirs.push(dir);
      writeFileSync(join(dir, 'audit.json'), JSON.stringify(report));
      writeFileSync(join(dir, 'waivers.json'), JSON.stringify({ waivers }));
      return spawnSync(
        process.execPath,
        [
          SCRIPT,
          '--input',
          join(dir, 'audit.json'),
          '--waivers',
          join(dir, 'waivers.json'),
          '--now',
          now,
        ],
        { encoding: 'utf8' },
      );
    }

    it('exits 0 for a clean report and for a waived advisory, 1 otherwise', () => {
      const waivers = [
        { advisory: 'GHSA-aaaa-bbbb-cccc', reason: 'dev only', expires: '2026-12-01' },
      ];
      expect(run({ vulnerabilities: {} }, [], '2026-11-05').status).toBe(0);
      expect(run(advisory('GHSA-aaaa-bbbb-cccc', 'high'), waivers, '2026-11-05').status).toBe(0);
      expect(run(advisory('GHSA-aaaa-bbbb-cccc', 'high'), [], '2026-11-05').status).toBe(1);
      expect(run(advisory('GHSA-aaaa-bbbb-cccc', 'high'), waivers, '2026-12-02').status).toBe(1);
    });
  });
});

const mockedNow = (): number => vi.getMockedSystemTime()?.getTime() ?? 0;

describe('a hanging language model (T-QA-078)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives way to the rules before the 4.2 s budget and marks the model down', async () => {
    const hang = createFakeTransport({ reply: {}, delayMs: 3_600_000 });
    const client = createLlmClient({ mode: 'live', transport: hang.transport });
    const input = {
      transcript: 'paddle seven three fifty',
      currentPriceCents: 30000,
      minIncrementCents: 2500,
      registeredPaddles: ['7'],
      speakerKnown: false,
      previousSegment: null,
    };
    const started = mockedNow();
    const outcome = client.parse(input, new AbortController().signal).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(LLM_TIMEOUT_MS);
    const err = await outcome;
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect((err as LlmUnavailableError).reason).toBe('timeout');
    expect(client.status).toBe('down');
    expect(hang.calls).toHaveLength(1);
    expect(hang.calls[0]?.signal.aborted).toBe(true);
    expect(mockedNow() - started).toBeLessThan(FALLBACK_BUDGET_MS);
  });
});

describe('call rate limit (T-QA-078)', () => {
  it('limits the 61st HTTP call from one address inside a minute', () => {
    const clock = new ManualClock(1_789_000_000_000);
    const limiter = new RateLimiter(clock);
    const results = Array.from({ length: 61 }, () => limiter.checkHttp('203.0.113.9', '/auctions'));
    expect(results.slice(0, 60).every((r) => r.ok)).toBe(true);
    expect(results[60]).toMatchObject({ ok: false, code: 'rate_limited' });
    // Another address is not affected, and the webhook route is never limited.
    expect(limiter.checkHttp('203.0.113.10', '/auctions').ok).toBe(true);
    expect(limiter.checkHttp('203.0.113.9', '/webhooks/paypal').ok).toBe(true);
  });
});
