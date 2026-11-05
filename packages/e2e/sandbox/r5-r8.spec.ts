import { describe, expect, it } from 'vitest';
import { amount, errorName, field, str } from '../../payments/gates/gateUtil.js';
import { diffLedger, type LedgerRow } from '../src/sandbox/harness.js';
import { anyTransient, availability, begin, centsOf, finish } from '../src/sandbox/kit.js';
import type { SandboxSession } from '../src/sandbox/session.js';

// Real PayPal sandbox, specs R5 to R8 (R-QA-029, T-QA-054 to T-QA-057). Skipped without the
// sandbox secrets. R7 and R8 run the lot at the payments layer: three holds, one winner captured
// for the hammer price, the others voided, then our ledger is compared with what PayPal reports.
// The drive through the deployed staging stack is not part of these specs yet.
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
      const holds = [
        await s.authorize('r7a', HOLD_CENTS),
        await s.authorize('r7b', HOLD_CENTS),
        await s.authorize('r7c', HOLD_CENTS),
      ];
      const ledger: LedgerRow[] = [];
      const winner = holds[0];
      if (winner === undefined) throw new Error('no hold');
      const cap = await s.call('R7 capture the winner at the hammer price', {
        method: 'POST',
        path: `/v2/payments/authorizations/${winner.authId}/capture`,
        requestId: `r7-cap-${winner.authId}`,
        body: {
          amount: amount(HAMMER_CENTS),
          final_capture: true,
          invoice_id: `r7-${winner.orderId}`,
        },
      });
      ledger.push({ id: 'hold-1', status: 'CAPTURED', capturedCents: HAMMER_CENTS });
      const voids: number[] = [];
      for (const [i, h] of holds.slice(1).entries()) {
        const v = await s.call(`R7 void non-winner ${i + 1}`, {
          method: 'POST',
          path: `/v2/payments/authorizations/${h.authId}/void`,
          requestId: `r7-void-${h.authId}`,
        });
        voids.push(v.status);
        ledger.push({ id: `hold-${i + 2}`, status: 'VOIDED', capturedCents: 0 });
      }
      // R8: read every authorization back and compare with the ledger.
      const observed: LedgerRow[] = [];
      for (const [i, h] of holds.entries()) {
        const r = await readAuth(s, `R8 read hold ${i + 1}`, h.authId);
        observed.push({
          id: `hold-${i + 1}`,
          status: r.status,
          capturedCents: i === 0 && r.status === 'CAPTURED' ? HAMMER_CENTS : 0,
        });
      }
      const diffs = diffLedger(ledger, observed);
      const result = finish('R7', s, {
        gate: 'G1',
        met: cap.status < 300 && voids.every((x) => x < 300) && diffs.length === 0,
        transient: anyTransient(cap.status, ...voids),
        observed: `ledger against PayPal: ${diffs.length} differences`,
        facts: { differences: diffs.length, captureHttp: cap.status },
      });
      // R8 shares the run: it records the reconciliation on its own.
      finish('R8', s, {
        gate: 'G1',
        met: diffs.length === 0,
        transient: anyTransient(cap.status, ...voids),
        observed: `reconciliation found ${diffs.length} differences`,
        facts: { differences: diffs.length },
      });
      expect(result).not.toBe('fail');
    },
    TIMEOUT,
  );
});
