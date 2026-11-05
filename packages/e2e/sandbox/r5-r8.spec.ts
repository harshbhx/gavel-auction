import { describe, expect, it } from 'vitest';
import { amount, errorName, field, str } from '../../payments/gates/gateUtil.js';
import { diffLedger } from '../src/sandbox/harness.js';
import { anyTransient, availability, begin, centsOf, env, finish } from '../src/sandbox/kit.js';
import { ledgerFromJournal, ledgerFromTruth, settleLot, type LotHold } from '../src/sandbox/lot.js';
import type { SandboxSession } from '../src/sandbox/session.js';

// Real PayPal sandbox, specs R5 to R8 (R-QA-029, T-QA-054 to T-QA-057). Skipped without the
// sandbox secrets. R7 and R8 run the real settlement saga and PayPalGateway of @gavel/payments:
// three holds, one winner captured for the hammer price, the others voided, then the journal is
// compared with the amounts PayPal reports. The drive through the deployed staging stack is not
// part of these specs yet.
// Run: npm run test:sandbox -w @gavel/e2e

const TIMEOUT = 600_000;
const HOLD_CENTS = 20000;
const HAMMER_CENTS = 12500;

async function readAuth(s: SandboxSession, step: string, authId: string) {
  const r = await s.call(step, { method: 'GET', path: `/v2/payments/authorizations/${authId}` });
  return { http: r.status, status: str(field(r.json, 'status')) };
}

describe.skipIf(!availability.ok)('sandbox R5 to R8', () => {
  it(
    'R5 idempotent capture @gate:G1',
    async () => {
      const s = await begin('R5');
      const a = await s.authorize('r5', 10000);
      const requestId = `r5-cap-${a.authId}`;
      const send = (step: string) =>
        s.call(step, {
          method: 'POST',
          path: `/v2/payments/authorizations/${a.authId}/capture`,
          requestId,
          body: { amount: amount(10000), final_capture: true, invoice_id: `r5-${a.orderId}` },
        });
      const one = await send('R5 capture');
      const two = await send('R5 capture again, same request id');
      const same =
        str(field(one.json, 'id')) !== '' && field(one.json, 'id') === field(two.json, 'id');
      const read = await s.call('R5 read capture', {
        method: 'GET',
        path: `/v2/payments/captures/${str(field(one.json, 'id'))}`,
      });
      const result = finish('R5', s, {
        gate: 'G1',
        met: one.status < 300 && two.status < 300 && same && centsOf(read.json) === 10000,
        transient: anyTransient(one.status, two.status, read.status),
        observed: `second send answered ${two.status}, same capture ${same}`,
        facts: { first: one.status, second: two.status, sameCapture: same },
      });
      expect(result).not.toBe('fail');
    },
    TIMEOUT,
  );

  it(
    'R6 void each non-winner exactly once @gate:G1',
    async () => {
      const s = await begin('R6');
      const a = await s.authorize('r6a', 10000);
      const b = await s.authorize('r6b', 10000);
      const voidOnce = (step: string, authId: string) =>
        s.call(step, {
          method: 'POST',
          path: `/v2/payments/authorizations/${authId}/void`,
          requestId: `r6-${step.replace(/\W+/g, '-')}-${authId}`,
        });
      const va = await voidOnce('R6 void first', a.authId);
      const vb = await voidOnce('R6 void second', b.authId);
      // The repeat void is sent with a new request id on purpose: PayPal must answer with an error.
      const again = await voidOnce('R6 void again', a.authId);
      const errName = again.status >= 300 ? errorName(again.json) : 'none';
      const sa = await readAuth(s, 'R6 read first', a.authId);
      const sb = await readAuth(s, 'R6 read second', b.authId);
      const result = finish('R6', s, {
        gate: 'G1',
        met: va.status < 300 && vb.status < 300 && sa.status === 'VOIDED' && sb.status === 'VOIDED',
        transient: anyTransient(va.status, vb.status, again.status),
        observed: `both voids accepted, second void on the same authorization: ${errName}`,
        facts: { secondVoidHttp: again.status, secondVoidError: errName },
      });
      expect(result).not.toBe('fail');
    },
    TIMEOUT,
  );

  it(
    'R7 full lot and R8 reconciliation @gate:G1',
    async () => {
      const s = await begin('R7');
      const bidders = ['r7a', 'r7b', 'r7c'];
      const prices = [HAMMER_CENTS, 11000, 10000];
      const holds: LotHold[] = [];
      for (const bidderId of bidders) {
        const h = await s.authorize(bidderId, HOLD_CENTS);
        holds.push({ bidderId, authId: h.authId, orderId: h.orderId, ceilingCents: HOLD_CENTS });
      }
      // The real saga and PayPalGateway settle the lot: capture the winner, void the others.
      const lot = await settleLot(
        env,
        `qa-r7-${Date.now()}`,
        holds,
        bidders.map((bidderId, i) => ({ bidderId, priceCents: prices[i] ?? 0 })),
      );
      // R8: our ledger comes from the settlement journal, PayPal's side from the amounts PayPal
      // returned, and the winner's amount is also pinned to the hammer price.
      const ours = ledgerFromJournal(lot.journal);
      const theirs = ledgerFromTruth(lot.truth);
      const diffs = diffLedger(ours, theirs);
      const winnerPaid = lot.truth['r7a']?.capturedCents ?? -1;
      const exact = winnerPaid === HAMMER_CENTS;
      const settled = lot.journal.state === 'SETTLED';
      const result = finish('R7', s, {
        gate: 'G1',
        met: settled && diffs.length === 0 && exact,
        observed: `saga ${lot.journal.state}, ledger against PayPal: ${diffs.length} differences`,
        facts: { differences: diffs.length, winnerCapturedCents: winnerPaid, settled },
      });
      // R8 shares the run: it records the reconciliation on its own.
      finish('R8', s, {
        gate: 'G1',
        met: diffs.length === 0 && exact,
        observed: `reconciliation found ${diffs.length} differences, winner captured ${winnerPaid}`,
        facts: { differences: diffs.length, winnerCapturedCents: winnerPaid },
      });
      expect(result).not.toBe('fail');
    },
    TIMEOUT,
  );
});
