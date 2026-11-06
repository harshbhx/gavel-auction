import { describe, expect, it } from 'vitest';
import { diffLedger } from '../src/sandbox/harness.js';
import { availability, env, finish, newRunId, sleep } from '../src/sandbox/kit.js';
import {
  ledgerFromJournal,
  ledgerFromTruth,
  settleLotWithCrash,
  type LotHold,
} from '../src/sandbox/lot.js';
import { openSession } from '../src/sandbox/session.js';

// R10: crash between the capture and the journal save. The real saga and PayPalGateway run a lot of
// three holds; the first run dies right after PayPal answered the winner's capture (boundary
// `after:capture`), before the journal records it. A second run resumes from the journal: it must
// adopt the capture PayPal already holds (no second capture; any capture call it does send carries
// the same PayPal-Request-Id), PayPal must end with exactly one capture for the hammer price on
// the winner, and the other two holds must be voided. Skipped without the sandbox secrets.
// Run: npm run test:sandbox -w @gavel/e2e

const TIMEOUT = 900_000;
const HOLD_CENTS = 20000;
const PRICES = [12500, 11000, 10000] as const;

describe.skipIf(!availability.ok)(
  `sandbox R10 crash between capture and journal save (${
    availability.ok ? 'secrets present' : 'sandbox secrets are absent'
  })`,
  () => {
    it(
      'R10 resume adopts the capture, never repeats it, losers voided @gate:G1',
      async () => {
        const s = await openSession({
          env,
          runId: newRunId('R10'),
          gate: 'QA-R10',
          now: () => Date.now(),
          sleep,
        });
        const bidders = ['r10a', 'r10b', 'r10c'];
        const holds: LotHold[] = [];
        for (const bidderId of bidders) {
          const h = await s.authorize(bidderId, HOLD_CENTS);
          holds.push({ bidderId, authId: h.authId, orderId: h.orderId, ceilingCents: HOLD_CENTS });
        }
        const lot = await settleLotWithCrash(
          env,
          `qa-r10-${Date.now()}`,
          holds,
          bidders.map((bidderId, i) => ({ bidderId, priceCents: PRICES[i] ?? 0 })),
          { label: 'after:capture' },
        );

        // The first run died, and its journal did not know about the capture.
        expect(lot.crashed).toBe(true);
        expect(lot.journalAtCrash.state).not.toBe('SETTLED');
        expect(lot.journalAtCrash.winner ?? null).toBeNull();
        const intent = lot.journalAtCrash.intent;
        expect(intent?.op).toBe('capture');
        const requestId = intent?.requestId ?? '';
        expect(requestId).not.toBe('');

        // Not repeated: the one capture call of run 1 used the saved request id, and a resume
        // sends none or the same id again.
        const first = lot.captureCalls.filter((c) => c.run === 1);
        expect(first).toHaveLength(1);
        expect(lot.captureCalls.every((c) => c.requestId === requestId)).toBe(true);

        // Final state: settled, winner adopted, PayPal holds exactly one capture for the hammer
        // price, the losers are voided with nothing captured.
        expect(lot.journal.state).toBe('SETTLED');
        expect(lot.journal.winner?.bidderId).toBe('r10a');
        expect(lot.journal.winner?.amountCents).toBe(PRICES[0]);
        const win = lot.truth['r10a'];
        expect(win?.capturedCents).toBe(PRICES[0]);
        expect(win?.captures?.length).toBe(1);
        expect(win?.captures?.[0]?.captureId).toBe(lot.journal.winner?.captureId);
        for (const loser of ['r10b', 'r10c']) {
          expect(lot.truth[loser]?.status).toBe('VOIDED');
          expect(lot.truth[loser]?.capturedCents).toBe(0);
        }
        expect(diffLedger(ledgerFromJournal(lot.journal), ledgerFromTruth(lot.truth))).toEqual([]);

        // Every expectation above held; record it for the nightly report (a thrown expectation
        // leaves no result file, which the report counts as a fail).
        finish('R10', s, {
          gate: 'G1',
          met: true,
          observed: 'resume adopted the capture: one capture on the winner, losers voided',
          facts: { crashes: 1, captures: win?.captures?.length ?? 0 },
        });
      },
      TIMEOUT,
    );
  },
);
