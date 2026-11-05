import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  deliverySkipReason,
  NO_STAGING_HOST_REASON,
  settle,
  skippedResult,
  type GateFlags,
} from '../src/sandbox/harness';

// R4 needs a deployed staging host to receive PayPal webhooks. Without GAVEL_STAGING_URL it is
// skipped with a reason; with it set, a missed expectation on a closed gate must still fail.
// The staging URL below is a placeholder that is never requested.

const STAGING = 'https://staging.example.invalid';

const gateOpen: GateFlags = {
  g1_remainder_mode: 'unknown',
  g2_card_authorize: false,
  g4_webhooks_verified: false,
};
const gateClosed: GateFlags = {
  g1_remainder_mode: 'A',
  g2_card_authorize: true,
  g4_webhooks_verified: true,
};

describe('R4 staging host guard', () => {
  it('skips R4 with the reason when no staging URL is set', () => {
    expect(deliverySkipReason({})).toBe('no staging host configured (GAVEL_STAGING_URL)');
    expect(deliverySkipReason({ GAVEL_STAGING_URL: '' })).toBe(NO_STAGING_HOST_REASON);
    expect(deliverySkipReason({ GAVEL_STAGING_URL: '   ' })).toBe(NO_STAGING_HOST_REASON);
  });

  it('lets R4 run when a staging URL is set', () => {
    expect(deliverySkipReason({ GAVEL_STAGING_URL: STAGING })).toBeUndefined();
  });

  it('records a skipped result with the reason and no facts', () => {
    const r = skippedResult('R4', 'G4', NO_STAGING_HOST_REASON, '2026-11-05T00:00:00.000Z');
    expect(r).toEqual({
      spec: 'R4',
      gate: 'G4',
      status: 'skipped',
      observed: 'no staging host configured (GAVEL_STAGING_URL)',
      facts: {},
      finishedAt: '2026-11-05T00:00:00.000Z',
    });
  });

  it('keeps a real delivery failure a fail once the G4 gate is closed', () => {
    // Staging is set, so R4 runs and misses its expectation: the closed gate turns it into a fail.
    expect(deliverySkipReason({ GAVEL_STAGING_URL: STAGING })).toBeUndefined();
    expect(settle('G4', false, gateClosed)).toBe('fail');
    expect(settle('G4', true, gateClosed)).toBe('pass');
  });

  it('keeps a missed R4 expectation inconclusive while G4 is open', () => {
    expect(settle('G4', false, gateOpen)).toBe('inconclusive');
  });

  it('wires the guard in the R4 spec before any session is opened', () => {
    const specPath = fileURLToPath(new URL('../sandbox/r1-r4.spec.ts', import.meta.url));
    const src = readFileSync(specPath, 'utf8');
    const guard = src.indexOf('deliverySkipReason(env)');
    const open = src.indexOf("begin('R4')");
    expect(guard).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(guard);
    expect(src).toContain('ctx.skip();');
  });
});
