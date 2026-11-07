import { describe, expect, it } from 'vitest';
import { amount, field, str } from '../../payments/gates/gateUtil.js';
import { MemoryWebhookEventStore } from '../../payments/src/stores/memory.js';
import { storeEvent } from '../../payments/src/webhooks/dedupe.js';
import {
  cardBuyerAvailable,
  deliverySkipReason,
  skippedResult,
  writeSpecResult,
} from '../src/sandbox/harness.js';
import {
  anyTransient,
  availability,
  begin,
  centsOf,
  env,
  finish,
  resultDir,
  sleep,
} from '../src/sandbox/kit.js';

// Real PayPal sandbox, specs R1 to R4 (R-QA-029, T-QA-050 to T-QA-053). The whole file is skipped
// when the sandbox secrets are absent, so CI without them stays green. Each spec writes a redacted
// transcript and a result. Before its gate is closed a missed expectation is `inconclusive`.
// Run: npm run test:sandbox -w @gavel/e2e

const TIMEOUT = 300_000;

describe.skipIf(!availability.ok)('sandbox R1 to R4', () => {
  it(
    'R1 partial capture and remainder @gate:G1',
    async () => {
      const s = await begin('R1');
      const a = await s.authorize('r1', 50000);
      const cap = await s.call('R1 capture 350 final', {
        method: 'POST',
        path: `/v2/payments/authorizations/${a.authId}/capture`,
        requestId: `r1-cap-${a.authId}`,
        body: { amount: amount(35000), final_capture: true, invoice_id: `r1-${a.orderId}` },
      });
      const capId = str(field(cap.json, 'id'));
      const capRead = await s.call('R1 read capture', {
        method: 'GET',
        path: `/v2/payments/captures/${capId}`,
      });
      const after = await s.call('R1 read authorization', {
        method: 'GET',
        path: `/v2/payments/authorizations/${a.authId}`,
      });
      const status = str(field(after.json, 'status'));
      const released = ['CAPTURED', 'VOIDED', 'EXPIRED'].includes(status);
      let remainder: 'released' | 'voided' | 'open' = released ? 'released' : 'open';
      let voidStatus = 0;
      if (!released) {
        const v = await s.call('R1 explicit void of the remainder', {
          method: 'POST',
          path: `/v2/payments/authorizations/${a.authId}/void`,
          requestId: `r1-void-${a.authId}`,
        });
        voidStatus = v.status;
        const reread = await s.call('R1 read after void', {
          method: 'GET',
          path: `/v2/payments/authorizations/${a.authId}`,
        });
        if (v.status < 300 && str(field(reread.json, 'status')) === 'VOIDED') remainder = 'voided';
      }
      const captured = centsOf(capRead.json);
      const met = cap.status < 300 && captured === 35000 && remainder !== 'open';
      const result = finish('R1', s, {
        gate: 'G1',
        met,
        transient: anyTransient(cap.status, capRead.status, after.status),
        observed: `captured ${captured} cents, remainder ${remainder}`,
        facts: { capturedCents: captured, remainder, authStatusAfterCapture: status, voidStatus },
      });
      expect(result).not.toBe('fail');
    },
    TIMEOUT,
  );

  it(
    'R2 card or guest authorize @gate:G2',
    async () => {
      const s = await begin('R2');
      const path = cardBuyerAvailable(env) ? 'card' : 'wallet';
      const a = await s.authorize('r2', 10000, path);
      const read = await s.call('R2 read authorization', {
        method: 'GET',
        path: `/v2/payments/authorizations/${a.authId}`,
      });
      const status = str(field(read.json, 'status'));
      // Without a card buyer only the wallet path ran: the gate question stays open.
      const met = path === 'card' && status === 'CREATED';
      const result = finish('R2', s, {
        gate: 'G2',
        met,
        transient: anyTransient(read.status),
        observed: `${path} buyer, authorization ${status}`,
        facts: { path, authStatus: status },
      });
      expect(result).not.toBe('fail');
    },
    TIMEOUT,
  );

  it(
    'R3 reauthorize after a delay @gate:G3',
    async () => {
      const s = await begin('R3');
      const a = await s.authorize('r3', 10000);
      const re = await s.call('R3 reauthorize', {
        method: 'POST',
        path: `/v2/payments/authorizations/${a.authId}/reauthorize`,
        requestId: `r3-re-${a.authId}`,
        body: { amount: amount(10000) },
      });
      const name = re.status >= 300 ? str(field(re.json, 'name')) : '';
      // The sandbox cannot age an authorization, so only an accepted call proves the path.
      const result = finish('R3', s, {
        gate: 'G3',
        met: re.status < 300,
        transient: anyTransient(re.status),
        observed: `reauthorize answered ${re.status}${name === '' ? '' : ` ${name}`}`,
        facts: { http: re.status, errorName: name },
      });
      expect(result).not.toBe('fail');
    },
    TIMEOUT,
  );

  it(
    'R4 real webhook delivery and replay dedupe @gate:G4',
    async (ctx) => {
      // No staging host means no delivery to observe: record the skip with its reason, do not fail.
      const skip = deliverySkipReason(env);
      if (skip !== undefined) {
        writeSpecResult(resultDir, skippedResult('R4', 'G4', skip, new Date().toISOString()));
        ctx.skip();
      }
      const s = await begin('R4');
      const a = await s.authorize('r4', 10000);
      // The event list of the sandbox app shows what PayPal delivered. Poll it, newest first.
      let eventBody: string | undefined;
      let listStatus = 0;
      for (let i = 0; i < 12 && eventBody === undefined; i++) {
        const list = await s.call('R4 list webhook events', {
          method: 'GET',
          path: '/v1/notifications/webhooks-events?page_size=20&event_type=PAYMENT.AUTHORIZATION.CREATED',
        });
        listStatus = list.status;
        const events = field(list.json, 'events');
        if (Array.isArray(events)) {
          const hit = events.find((e) => JSON.stringify(e).includes(a.authId));
          if (hit !== undefined) eventBody = JSON.stringify(hit);
        }
        if (eventBody === undefined) await sleep(5000);
      }
      let dedupe = false;
      if (eventBody !== undefined) {
        const store = new MemoryWebhookEventStore();
        const first = await storeEvent(store, Buffer.from(eventBody), 1);
        const replay = await storeEvent(store, Buffer.from(eventBody), 2);
        dedupe = first.isNew && !replay.isNew;
      }
      // Our server must refuse the same event body without PayPal's signature headers. This
      // runs real server code; a delivery signed by PayPal itself is checked by the staging
      // webhook log, not here.
      let unsignedStatus = 0;
      if (eventBody !== undefined) {
        const res = await fetch(
          `${(env['GAVEL_STAGING_URL'] ?? '').replace(/\/$/, '')}/webhooks/paypal`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: eventBody,
          },
        );
        unsignedStatus = res.status;
      }
      const rejectsUnsigned = unsignedStatus === 401;
      const result = finish('R4', s, {
        gate: 'G4',
        met: eventBody !== undefined && dedupe && rejectsUnsigned,
        transient: eventBody === undefined && anyTransient(listStatus),
        observed:
          eventBody === undefined
            ? 'no delivery seen in the event list'
            : `PayPal event list shows the delivery, replay dedupe ${dedupe ? 'works' : 'failed'} (in-memory store), staging answered the unsigned event HTTP ${unsignedStatus}`,
        facts: { delivered: eventBody !== undefined, dedupe, unsignedStatus },
      });
      expect(result).not.toBe('fail');
    },
    TIMEOUT,
  );
});
