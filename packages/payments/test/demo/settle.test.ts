import { describe, expect, it } from 'vitest';
import { checkCrashResume } from '../sandbox/crash.sandbox.js';
import {
  fakeDemoEnv,
  parseDemoAuths,
  runCrashResume,
  sandboxDemoEnv,
} from '../../demo/settle-lib.js';
import { LATENCY_TARGETS_MS, PaymentsConfigError, SAGA_DEFAULTS } from '../../src/config.js';
import { DEFAULT_MAX_VOID_RESUMES, DEFAULT_VOID_CONCURRENCY } from '../../src/saga/void.js';
import { DEFAULT_UNKNOWN_DEADLINE_MS } from '../../src/saga/unknown.js';

describe('settlement demo against the fake', () => {
  it('survives a kill between capture and journal save with one capture', async () => {
    const lines: string[] = [];
    const r = await runCrashResume(fakeDemoEnv(), (l) => lines.push(l));
    expect(r.crashes).toBe(1);
    expect(r.journal.state).toBe('SETTLED');
    expect(r.journal.winner?.bidderId).toBe('b1');
    expect(r.capturedCents).toEqual({ b1: 22000, b2: 0, b3: 0 });
    expect(r.ladder['b1']).toBe('Charged at winning price');
    expect(r.ladder['b2']).toBe('Released');
    expect(lines.some((l) => l.includes('killed at after:capture'))).toBe(true);
    expect(lines.some((l) => l.includes('1 capture(s) at PayPal'))).toBe(true);
  });

  it('passes the T-PAY-094 check with a clean reconcile (fake)', async () => {
    const { report } = await checkCrashResume(fakeDemoEnv());
    expect(report.journalState).toBe('SETTLED');
  });

  it('refuses sandbox mode outside the sandbox before any request', () => {
    expect(() =>
      sandboxDemoEnv({
        PAYPAL_ENV: 'live',
        PAYPAL_CLIENT_ID: 'x',
        PAYPAL_CLIENT_SECRET: 'y',
      }),
    ).toThrow(PaymentsConfigError);
  });

  it('parses the sandbox authorization list', () => {
    const holds = parseDemoAuths('b1:A1:30000,b2:A2:25000,b3:A3:25000');
    expect(holds['b2']).toEqual({ authId: 'A2', ceilingCents: 25000 });
    expect(() => parseDemoAuths('b1:A1:30000')).toThrow(/no entry/);
    expect(() => parseDemoAuths('b1:A1:x')).toThrow(/DEMO_AUTHS/);
  });
});

describe('saga defaults (R-PAY-152)', () => {
  it('match the constants the saga uses', () => {
    expect(SAGA_DEFAULTS.voidConcurrency).toBe(DEFAULT_VOID_CONCURRENCY);
    expect(SAGA_DEFAULTS.maxVoidResumes).toBe(DEFAULT_MAX_VOID_RESUMES);
    expect(SAGA_DEFAULTS.unknownDeadlineMs).toBe(DEFAULT_UNKNOWN_DEADLINE_MS);
  });

  it('keeps the settled target above the capture target', () => {
    expect(LATENCY_TARGETS_MS.hammerToSettledSixHoldsP95).toBeGreaterThan(
      LATENCY_TARGETS_MS.hammerToCapturedP95,
    );
  });
});
