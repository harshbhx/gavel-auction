import { describe, expect, it } from 'vitest';
import { diffLedger, writeSpecResult } from '../src/sandbox/harness.js';
import { ledgerFromJournal, ledgerFromTruth, settleLot, type LotHold } from '../src/sandbox/lot.js';
import { availability, env, finish, newRunId, resultDir, sleep } from '../src/sandbox/kit.js';
import { openSession } from '../src/sandbox/session.js';

// R9: three different sandbox buyers. A wins and is captured, B is the runner-up and D loses; B
// and D are released. Needs the wallet buyer (A) and the extra buyers SANDBOX_BUYER2_* (B) and
// SANDBOX_BUYER3_* (D); skipped when any is absent.
// Run: npm run test:sandbox -w @gavel/e2e

const TIMEOUT = 900_000;
const HOLD_CENTS = 20000;
const PRICES = { a: 12500, b: 11000, d: 10000 } as const;

const blank = (v: string | undefined): boolean => v === undefined || v.trim() === '';
const extraBuyers = ![
  'SANDBOX_BUYER2_EMAIL',
  'SANDBOX_BUYER2_PASSWORD',
  'SANDBOX_BUYER3_EMAIL',
  'SANDBOX_BUYER3_PASSWORD',
].some((n) => blank(env[n]));
const reason = availability.ok
  ? 'SANDBOX_BUYER2_* or SANDBOX_BUYER3_* secrets are absent'
  : 'sandbox secrets are absent';

/** A session whose wallet buyer is the buyer stored under `prefix`. */
function sessionFor(prefix: 'SANDBOX_BUYER' | 'SANDBOX_BUYER2' | 'SANDBOX_BUYER3', label: string) {
  return openSession({
    env: {
      ...env,
      SANDBOX_BUYER_EMAIL: env[`${prefix}_EMAIL`],
      SANDBOX_BUYER_PASSWORD: env[`${prefix}_PASSWORD`],
    },
    runId: newRunId(label),
    gate: `QA-${label}`,
    now: () => Date.now(),
    sleep,
  });
}

describe.skipIf(!availability.ok || !extraBuyers)(`sandbox R9 three buyers (${reason})`, () => {
  it(
    'R9 winner captured, runner-up and loser released @gate:G1',
    async () => {
      const sa = await sessionFor('SANDBOX_BUYER', 'R9a');
      const sb = await sessionFor('SANDBOX_BUYER2', 'R9b');
      const sd = await sessionFor('SANDBOX_BUYER3', 'R9d');
      const holds: LotHold[] = [];
      for (const [bidderId, s] of [
        ['a', sa],
        ['b', sb],
        ['d', sd],
      ] as const) {
        const h = await s.authorize(`r9${bidderId}`, HOLD_CENTS);
        holds.push({ bidderId, authId: h.authId, orderId: h.orderId, ceilingCents: HOLD_CENTS });
      }
      const lot = await settleLot(
        env,
        `qa-r9-${Date.now()}`,
        holds,
        (['a', 'b', 'd'] as const).map((bidderId) => ({ bidderId, priceCents: PRICES[bidderId] })),
      );
      const diffs = diffLedger(ledgerFromJournal(lot.journal), ledgerFromTruth(lot.truth));
      expect(lot.journal.state).toBe('SETTLED');
      expect(lot.journal.winner?.bidderId).toBe('a');
      expect(lot.truth['a']?.status).toBe('CAPTURED');
      expect(lot.truth['a']?.capturedCents).toBe(PRICES.a);
      expect(lot.truth['b']?.status).toBe('VOIDED');
      expect(lot.truth['b']?.capturedCents).toBe(0);
      expect(lot.truth['d']?.status).toBe('VOIDED');
      expect(lot.truth['d']?.capturedCents).toBe(0);
      expect(diffs).toEqual([]);

      // Every expectation above held; record it for the nightly report (a thrown expectation
      // leaves no result file, which the report counts as a fail).
      finish('R9', sa, {
        gate: 'G1',
        met: true,
        observed:
          'three buyers: winner captured, runner-up and loser released, journal equals PayPal',
        facts: { buyers: 3, captured: lot.truth['a']?.capturedCents ?? 0 },
      });
    },
    TIMEOUT,
  );
});

// With the main sandbox secrets present but the extra buyers absent, R9 cannot run. Write an
// honest skipped result so the report shows `skipped` for R9, not a missing-result failure.
describe.runIf(availability.ok && !extraBuyers)('sandbox R9 without the extra buyers', () => {
  it('records R9 as skipped', () => {
    writeSpecResult(resultDir, {
      spec: 'R9',
      gate: 'G1',
      status: 'skipped',
      observed: 'SANDBOX_BUYER2_* or SANDBOX_BUYER3_* secrets are absent',
      facts: {},
      finishedAt: new Date().toISOString(),
    });
  });
});
